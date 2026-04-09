import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  billingContact,
  billingCustomer,
  commercialDeal,
  commercialOffer,
  commercialOfferItem,
  commercialOfferStatusHistory,
  organization,
  paymentRecord,
  platformEventLog,
  subscription,
} from "@calibra-facil/db/schema";
import {
  CancelCommercialOfferSchema,
  CommercialOfferPreviewInputSchema,
  CreateCommercialOfferSchema,
  ReissueCommercialOfferSchema,
  SyncBillingCustomerSchema,
} from "@calibra-facil/schemas";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import type { AuthVariables } from "../middleware/permission";
import { ensureBillingCustomer, getBillingContacts, listRecentOffers } from "../services/commercial/common";
import { previewCommercialOffer } from "../services/commercial/preview";
import { issueCommercialOffer } from "../services/commercial/issue";
import { cancelCommercialOffer } from "../services/commercial/cancel";
import { reissueCommercialOffer } from "../services/commercial/reissue";

function resolvePublicAppUrl(c: { env?: unknown }) {
  const configured =
    (c.env as Record<string, unknown> | undefined)?.APP_URL ?? process.env.APP_URL;

  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim().replace(/\/$/, "")
    : "https://calibrafacil.com";
}

function attachCustomerCheckoutUrl<T extends {
  customerCheckoutUrlPath?: string | null;
}>(offer: T, publicAppUrl: string) {
  return {
    ...offer,
    customerCheckoutUrl: offer.customerCheckoutUrlPath
      ? `${publicAppUrl}${offer.customerCheckoutUrlPath}`
      : null,
  };
}

const OrganizationsQuerySchema = SyncBillingCustomerSchema.pick({
  organizationId: true,
}).partial().extend({
  search: SyncBillingCustomerSchema.shape.name.optional(),
});

const CreateBillingContactSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email(),
  phone: z.string().trim().max(32).optional(),
  role: z.string().trim().max(120).optional(),
  isPrimary: z.boolean().optional().default(false),
  notes: z.string().trim().max(1000).optional(),
});

async function logCommercialEvent(params: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(platformEventLog).values({
    actorUserId: params.actorUserId ?? null,
    targetUserId: null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
  });
}

export const backofficeCommercialRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get("/organizations", zValidator("query", OrganizationsQuerySchema), async (c) => {
    const { search } = c.req.valid("query");
    const filters = [eq(organization.type, "LAB")];

    if (search?.trim()) {
      filters.push(
        or(
          ilike(organization.name, `%${search.trim()}%`),
          ilike(organization.slug, `%${search.trim()}%`),
          ilike(organization.cnpj, `%${search.trim()}%`),
        )!,
      );
    }

    const rows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        cnpj: organization.cnpj,
        email: organization.email,
        phone: organization.phone,
      })
      .from(organization)
      .where(and(...filters))
      .orderBy(asc(organization.name))
      .limit(50);

    return c.json({ data: rows });
  })
  .get("/organizations/:organizationId/context", async (c) => {
    const organizationId = c.req.param("organizationId");
    const publicAppUrl = resolvePublicAppUrl(c);

    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), eq(organization.type, "LAB")),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    const [currentSubscription, billingCustomerRecord, contacts, offers, deals] =
      await Promise.all([
        db.query.subscription.findFirst({
          where: eq(subscription.organizationId, organizationId),
        }),
        db.query.billingCustomer.findFirst({
          where: eq(billingCustomer.organizationId, organizationId),
        }),
        getBillingContacts(organizationId),
        listRecentOffers(organizationId),
        db.query.commercialDeal.findMany({
          where: eq(commercialDeal.organizationId, organizationId),
          orderBy: [desc(commercialDeal.createdAt)],
          limit: 10,
        }),
      ]);

    return c.json({
      organization: org,
      subscription: currentSubscription,
      billingCustomer: billingCustomerRecord ?? null,
      billingContacts: contacts,
      recentOffers: offers.map((offer) =>
        attachCustomerCheckoutUrl(offer, publicAppUrl),
      ),
      deals,
    });
  })
  .post(
    "/billing-customer/sync",
    zValidator("json", SyncBillingCustomerSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");
      const result = await db.transaction((tx) =>
        ensureBillingCustomer(tx, input.organizationId, session.user.id, {
          name: input.name,
          email: input.email,
          phone: input.phone,
          taxId: input.taxId,
          address: input.address as Record<string, unknown> | undefined,
        }),
      );

      await logCommercialEvent({
        actorUserId: session.user.id,
        action: "commercial.billing_customer.synced",
        entityType: "billing_customer",
        entityId: String(result.id),
        details: {
          organizationId: input.organizationId,
        },
      });

      return c.json({ billingCustomer: result });
    },
  )
  .post(
    "/billing-contacts",
    zValidator("json", CreateBillingContactSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");

      const [contact] = await db
        .insert(billingContact)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          role: input.role ?? null,
          isPrimary: input.isPrimary ?? false,
          notes: input.notes ?? null,
          createdBy: session.user.id,
        })
        .returning();

      if (!contact) {
        return c.json({ error: "Falha ao criar contato de cobrança" }, 500);
      }

      await logCommercialEvent({
        actorUserId: session.user.id,
        action: "commercial.billing_contact.created",
        entityType: "billing_contact",
        entityId: String(contact.id),
        details: {
          organizationId: input.organizationId,
        },
      });

      return c.json({ contact }, 201);
    },
  )
  .post(
    "/offers/preview",
    zValidator("json", CommercialOfferPreviewInputSchema),
    async (c) => {
      const preview = previewCommercialOffer(c.req.valid("json"));
      return c.json(preview);
    },
  )
  .post("/offers", zValidator("json", CreateCommercialOfferSchema), async (c) => {
    const session = c.get("session");
    const input = c.req.valid("json");
    const publicAppUrl = resolvePublicAppUrl(c);

    const offer = await issueCommercialOffer(
      input,
      session.user.id,
      input.idempotencyKey,
    );

    await logCommercialEvent({
      actorUserId: session.user.id,
      action: "commercial.offer.issued",
      entityType: "commercial_offer",
      entityId: offer.id,
      details: {
        organizationId: offer.organizationId,
        dealId: offer.dealId,
      },
    });

    return c.json(
      { offer: attachCustomerCheckoutUrl(offer, publicAppUrl) },
      201,
    );
  })
  .get("/offers", async (c) => {
    const organizationId = c.req.query("organizationId");
    const status = c.req.query("status");
    const dealId = c.req.query("dealId");
    const kind = c.req.query("kind");

    const filters = [];
    if (organizationId) filters.push(eq(commercialOffer.organizationId, organizationId));
    if (status) filters.push(eq(commercialOffer.status, status as any));
    if (dealId) filters.push(eq(commercialOffer.dealId, dealId));
    if (kind) filters.push(eq(commercialOffer.kind, kind as any));

    const rows = await db
      .select()
      .from(commercialOffer)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(commercialOffer.createdAt))
      .limit(100);

    return c.json({
      data: rows.map((offer) =>
        attachCustomerCheckoutUrl(offer, resolvePublicAppUrl(c)),
      ),
    });
  })
  .get("/offers/:offerId", async (c) => {
    const offerId = c.req.param("offerId");
    const publicAppUrl = resolvePublicAppUrl(c);
    const offer = await db.query.commercialOffer.findFirst({
      where: eq(commercialOffer.id, offerId),
    });

    if (!offer) {
      return c.json({ error: "Oferta não encontrada" }, 404);
    }

    const [items, statusHistory, payments] = await Promise.all([
      db.query.commercialOfferItem.findMany({
        where: eq(commercialOfferItem.offerId, offerId),
        orderBy: [asc(commercialOfferItem.id)],
      }),
      db.query.commercialOfferStatusHistory.findMany({
        where: eq(commercialOfferStatusHistory.offerId, offerId),
        orderBy: [asc(commercialOfferStatusHistory.createdAt)],
      }),
      db.query.paymentRecord.findMany({
        where: eq(paymentRecord.commercialOfferId, offerId),
        orderBy: [desc(paymentRecord.createdAt)],
      }),
    ]);

    return c.json({
      offer: attachCustomerCheckoutUrl(offer, publicAppUrl),
      items,
      statusHistory,
      payments,
    });
  })
  .post(
    "/offers/:offerId/cancel",
    zValidator("json", CancelCommercialOfferSchema),
    async (c) => {
      const session = c.get("session");
      const offerId = c.req.param("offerId");
      const input = c.req.valid("json");
      const offer = await cancelCommercialOffer(offerId, input.reason, session.user.id);

      await logCommercialEvent({
        actorUserId: session.user.id,
        action: "commercial.offer.canceled",
        entityType: "commercial_offer",
        entityId: offer.id,
        details: {
          reason: input.reason,
          organizationId: offer.organizationId,
        },
      });

      return c.json({
        offer: attachCustomerCheckoutUrl(offer, resolvePublicAppUrl(c)),
      });
    },
  )
  .post(
    "/offers/:offerId/reissue",
    zValidator("json", ReissueCommercialOfferSchema),
    async (c) => {
      const session = c.get("session");
      const offerId = c.req.param("offerId");
      const reissued = await reissueCommercialOffer(
        offerId,
        c.req.valid("json"),
        session.user.id,
      );

      await logCommercialEvent({
        actorUserId: session.user.id,
        action: "commercial.offer.reissued",
        entityType: "commercial_offer",
        entityId: reissued.id,
        details: {
          originalOfferId: offerId,
          organizationId: reissued.organizationId,
        },
      });

      return c.json(
        {
          offer: attachCustomerCheckoutUrl(reissued, resolvePublicAppUrl(c)),
        },
        201,
      );
    },
  )
  .get("/deals/:dealId", async (c) => {
    const dealId = c.req.param("dealId");
    const deal = await db.query.commercialDeal.findFirst({
      where: eq(commercialDeal.id, dealId),
    });

    if (!deal) {
      return c.json({ error: "Deal não encontrado" }, 404);
    }

    const offers = await db.query.commercialOffer.findMany({
      where: eq(commercialOffer.dealId, dealId),
      orderBy: [desc(commercialOffer.createdAt)],
    });

    return c.json({
      deal,
      offers: offers.map((offer) =>
        attachCustomerCheckoutUrl(offer, resolvePublicAppUrl(c)),
      ),
    });
  });
