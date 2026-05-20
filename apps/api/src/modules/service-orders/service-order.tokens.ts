import { db } from "@calibra-facil/db";
import {
  serviceOrder,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import { canApproveServiceOrderQuote } from "@calibra-facil/shared";
import { eq } from "drizzle-orm";
import {
  hashServiceOrderToken,
  recordServiceOrderEvent,
} from "../../lib/service-order-workflow";
import { getQuoteForAction } from "./service-order.queries";
import {
  getServiceOrderDetail,
  toClientVisibleServiceOrderDetail,
} from "./service-order.read-model";

type RequestMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type PublicTokenResult<TData> =
  | { status: "ok"; data: TData }
  | { status: "not_found"; error: string }
  | { status: "conflict"; error: string };

export async function getPublicServiceOrderAccessByToken(token: string) {
  const tokenHash = await hashServiceOrderToken(token);
  const [access] = await db
    .select()
    .from(serviceOrderPublicAccessToken)
    .where(eq(serviceOrderPublicAccessToken.tokenHash, tokenHash))
    .limit(1);

  if (
    !access ||
    access.revokedAt ||
    (access.expiresAt && access.expiresAt < new Date())
  ) {
    return null;
  }

  return access;
}

export async function viewPublicServiceOrderAccess(
  token: string,
  metadata: RequestMetadata,
): Promise<PublicTokenResult<unknown>> {
  const access = await getPublicServiceOrderAccessByToken(token);
  if (!access)
    return { status: "not_found", error: "Link invalido ou expirado" };

  await db
    .update(serviceOrderPublicAccessToken)
    .set({ lastViewedAt: new Date() })
    .where(eq(serviceOrderPublicAccessToken.id, access.id));

  const detail = await getServiceOrderDetail(
    access.serviceOrderId,
    access.organizationId,
  );
  if (!detail) return { status: "not_found", error: "OS nao encontrada" };

  await recordServiceOrderEvent({
    organizationId: detail.organizationId,
    unitId: detail.unitId,
    serviceOrderId: detail.id,
    actorType: "public_token",
    actorId: String(access.id),
    eventType: "service_order.public_link_viewed",
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null,
  });

  return { status: "ok", data: toClientVisibleServiceOrderDetail(detail) };
}

export async function approveQuoteWithPublicServiceOrderAccess(
  token: string,
  metadata: RequestMetadata,
): Promise<PublicTokenResult<{ ok: true }>> {
  const access = await getPublicServiceOrderAccessByToken(token);
  if (!access?.quoteId) {
    return { status: "not_found", error: "Link invalido ou expirado" };
  }

  const quote = await getQuoteForAction(access.serviceOrderId, access.quoteId);
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, access.serviceOrderId))
    .limit(1);

  if (!quote || !order || !canApproveServiceOrderQuote(quote.status)) {
    return {
      status: "conflict",
      error: "Orcamento nao pode ser aprovado",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderQuote)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(serviceOrderQuote.id, quote.id));
    await tx
      .update(serviceOrder)
      .set({
        status: "quote_approved",
        approvedAt: new Date(),
        totalApprovedCents: quote.totalCents,
      })
      .where(eq(serviceOrder.id, order.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "public_token",
        actorId: String(access.id),
        eventType: "service_order.quote_approved_by_client",
        metadata: { quoteId: quote.id },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
      tx,
    );
  });

  return { status: "ok", data: { ok: true } };
}

export async function rejectQuoteWithPublicServiceOrderAccess(
  token: string,
  input: { rejectionReason?: string | null },
  metadata: RequestMetadata,
): Promise<PublicTokenResult<{ ok: true }>> {
  const access = await getPublicServiceOrderAccessByToken(token);
  if (!access?.quoteId) {
    return { status: "not_found", error: "Link invalido ou expirado" };
  }

  const quote = await getQuoteForAction(access.serviceOrderId, access.quoteId);
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, access.serviceOrderId))
    .limit(1);

  if (!quote || !order) {
    return { status: "not_found", error: "Orcamento nao encontrado" };
  }

  if (!canApproveServiceOrderQuote(quote.status)) {
    return {
      status: "conflict",
      error: "Orcamento nao pode ser recusado",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderQuote)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: input.rejectionReason ?? null,
      })
      .where(eq(serviceOrderQuote.id, quote.id));
    await tx
      .update(serviceOrder)
      .set({ status: "quote_rejected", rejectedAt: new Date() })
      .where(eq(serviceOrder.id, order.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "public_token",
        actorId: String(access.id),
        eventType: "service_order.quote_rejected_by_client",
        metadata: { quoteId: quote.id, reason: input.rejectionReason },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
      tx,
    );
  });

  return { status: "ok", data: { ok: true } };
}
