import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import { organizationCustomDomain } from "@calibra-facil/db/schema";
import {
  buildPortalDomainVerificationHost,
  createPortalDomainVerificationToken,
  getOrganizationCustomDomain,
  getPortalBaseUrlForLabOrganization,
  sanitizePortalHostname,
} from "../lib/portal-domains";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { and, eq, ne } from "drizzle-orm";

const CreatePortalDomainSchema = z.object({
  hostname: z.string().trim().min(3).max(255),
});

function stripTxtQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

async function fetchTxtAnswers(hostname: string): Promise<string[]> {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=TXT`,
    {
      headers: {
        Accept: "application/dns-json",
      },
    },
  );

  if (!response.ok) return [];

  const payload = (await response.json()) as {
    Answer?: Array<{ data?: string }>;
  };

  return (payload.Answer ?? [])
    .map((answer) => answer.data?.trim())
    .filter((value): value is string => Boolean(value))
    .map(stripTxtQuotes);
}

function serializeDomain(record: typeof organizationCustomDomain.$inferSelect | null) {
  if (!record) return null;

  return {
    id: record.id,
    hostname: record.hostname,
    verifiedAt: record.verifiedAt,
    lastVerifiedAt: record.lastVerifiedAt,
    activatedAt: record.activatedAt,
    isActive: record.isActive,
    verification: {
      type: "TXT" as const,
      host: buildPortalDomainVerificationHost(record.hostname),
      value: record.verificationToken,
    },
  };
}

export const portalDomainsRouter = new Hono<{ Variables: AuthVariables }>()
  .get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const member = c.get("member");
    const record = await getOrganizationCustomDomain(member.organizationId);
    const portalBaseUrl = await getPortalBaseUrlForLabOrganization(
      member.organizationId,
    );

    return c.json({
      domain: serializeDomain(record ?? null),
      portalBaseUrl,
    });
  })
  .post(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_domain"),
    zValidator("json", CreatePortalDomainSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const hostname = sanitizePortalHostname(input.hostname);

      if (!hostname) {
        return c.json({ error: "Hostname inválido para domínio personalizado" }, 400);
      }

      const collision = await db.query.organizationCustomDomain.findFirst({
        where: and(
          eq(organizationCustomDomain.hostname, hostname),
          ne(organizationCustomDomain.organizationId, member.organizationId),
        ),
      });

      if (collision) {
        return c.json({ error: "Este domínio já está em uso por outra organização" }, 409);
      }

      const existing = await getOrganizationCustomDomain(member.organizationId);
      const verificationToken = createPortalDomainVerificationToken();

      if (existing) {
        const [updated] = await db
          .update(organizationCustomDomain)
          .set({
            hostname,
            verificationToken,
            verifiedAt: null,
            lastVerifiedAt: null,
            activatedAt: null,
            isActive: false,
            updatedAt: new Date(),
          })
          .where(eq(organizationCustomDomain.id, existing.id))
          .returning();

        return c.json({ domain: serializeDomain(updated || null) });
      }

      const [created] = await db
        .insert(organizationCustomDomain)
        .values({
          id: crypto.randomUUID(),
          organizationId: member.organizationId,
          hostname,
          verificationToken,
          createdBy: session.user.id,
        })
        .returning();

      return c.json({ domain: serializeDomain(created || null) }, 201);
    },
  )
  .post(
    "/verify",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_domain"),
    async (c) => {
      const member = c.get("member");
      const record = await getOrganizationCustomDomain(member.organizationId);

      if (!record) {
        return c.json({ error: "Nenhum domínio configurado" }, 404);
      }

      const answers = await fetchTxtAnswers(
        buildPortalDomainVerificationHost(record.hostname),
      );
      const verified = answers.includes(record.verificationToken);

      if (!verified) {
        return c.json(
          {
            error: "Registro TXT ainda não propagado ou token incorreto",
            verification: {
              host: buildPortalDomainVerificationHost(record.hostname),
              value: record.verificationToken,
            },
          },
          400,
        );
      }

      const [updated] = await db
        .update(organizationCustomDomain)
        .set({
          verifiedAt: record.verifiedAt ?? new Date(),
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(organizationCustomDomain.id, record.id))
        .returning();

      return c.json({ domain: serializeDomain(updated ?? null) });
    },
  )
  .post(
    "/activate",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    requireFeature("custom_domain"),
    async (c) => {
      const member = c.get("member");
      const record = await getOrganizationCustomDomain(member.organizationId);

      if (!record) {
        return c.json({ error: "Nenhum domínio configurado" }, 404);
      }

      if (!record.verifiedAt) {
        return c.json({ error: "Verifique o domínio antes de ativá-lo" }, 400);
      }

      const [updated] = await db
        .update(organizationCustomDomain)
        .set({
          isActive: true,
          activatedAt: record.activatedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(organizationCustomDomain.id, record.id))
        .returning();

      return c.json({ domain: serializeDomain(updated ?? null) });
    },
  )
  .delete(
    "/",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const record = await getOrganizationCustomDomain(member.organizationId);

      if (!record) {
        return c.json({ success: true });
      }

      await db
        .delete(organizationCustomDomain)
        .where(eq(organizationCustomDomain.id, record.id));

      return c.json({ success: true });
    },
  );
