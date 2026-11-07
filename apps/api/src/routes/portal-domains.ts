import { createRouter } from "../server/router";
import { portalDomainEndpoints } from "@calibra-facil/contracts";
import { organizationCustomDomain } from "@calibra-facil/db/schema";
import {
  buildPortalDomainVerificationHost,
  createPortalDomainVerificationToken,
  findPortalHostnameOwnedByOtherOrganization,
  getOrganizationCustomDomain,
  getPortalBaseUrlForLabOrganization,
  sanitizePortalHostname,
} from "../lib/portal-domains";
import { writeOrganizationAuditEvent } from "../lib/audit";
import { conflict, invalid, notFound } from "../lib/domain-errors";
import { mount } from "../lib/endpoint-mount";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
  withLabPermission,
} from "../middleware/permission";
import { eq } from "drizzle-orm";

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

  const payload: unknown = await response.json();
  const answerValue =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.fromEntries(Object.entries(payload)).Answer
      : null;
  const answers = Array.isArray(answerValue) ? answerValue : [];

  return answers
    .map((answer) =>
      answer && typeof answer === "object" && !Array.isArray(answer)
        ? Object.fromEntries(Object.entries(answer)).data
        : null,
    )
    .map((data) => (typeof data === "string" ? data.trim() : null))
    .filter((value): value is string => Boolean(value))
    .map(stripTxtQuotes);
}

function serializeDomain(
  record: typeof organizationCustomDomain.$inferSelect | null,
) {
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

function buildPortalDomainStatusSummary(params: {
  record: typeof organizationCustomDomain.$inferSelect | null;
  portalBaseUrl: string;
  observedTxtValues: string[];
}) {
  if (!params.record) {
    return {
      status: "not_configured" as const,
      readiness: "not_ready" as const,
      canActivate: false,
      message: "Nenhum domínio personalizado configurado para o portal.",
      diagnostics: {
        host: null,
        expectedValue: null,
        observedValues: [],
      },
    };
  }

  const host = buildPortalDomainVerificationHost(params.record.hostname);
  const expectedValue = params.record.verificationToken;
  const observedValues = params.observedTxtValues;
  const txtMatched = observedValues.includes(expectedValue);

  if (params.record.isActive && params.record.verifiedAt) {
    return {
      status: "active" as const,
      readiness: "active" as const,
      canActivate: false,
      message: `Domínio ativo apontando o portal em ${params.portalBaseUrl}.`,
      diagnostics: {
        host,
        expectedValue,
        observedValues,
      },
    };
  }

  if (params.record.verifiedAt) {
    return {
      status: "verified" as const,
      readiness: "ready" as const,
      canActivate: true,
      message: "Domínio verificado e pronto para ativação.",
      diagnostics: {
        host,
        expectedValue,
        observedValues,
      },
    };
  }

  if (txtMatched) {
    return {
      status: "ready_to_verify" as const,
      readiness: "not_ready" as const,
      canActivate: false,
      message:
        "TXT encontrado. Confirme a verificação para liberar a ativação.",
      diagnostics: {
        host,
        expectedValue,
        observedValues,
      },
    };
  }

  if (observedValues.length === 0) {
    return {
      status: "waiting_dns" as const,
      readiness: "not_ready" as const,
      canActivate: false,
      message: "O TXT ainda não foi encontrado. Aguarde a propagação do DNS.",
      diagnostics: {
        host,
        expectedValue,
        observedValues,
      },
    };
  }

  return {
    status: "token_mismatch" as const,
    readiness: "not_ready" as const,
    canActivate: false,
    message:
      "O DNS respondeu, mas o TXT encontrado não corresponde ao token esperado.",
    diagnostics: {
      host,
      expectedValue,
      observedValues,
    },
  };
}

const PREFIX = "/api/portal-domains";

export const portalDomainsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  portalDomainsRouter,
  PREFIX,
  portalDomainEndpoints.get,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c) => {
    const member = c.get("member");
    const record = await getOrganizationCustomDomain(member.organizationId);
    const portalBaseUrl = await getPortalBaseUrlForLabOrganization(
      member.organizationId,
    );
    const observedTxtValues = record
      ? await fetchTxtAnswers(
          buildPortalDomainVerificationHost(record.hostname),
        )
      : [];

    return {
      domain: serializeDomain(record ?? null),
      portalBaseUrl,
      statusSummary: buildPortalDomainStatusSummary({
        record: record ?? null,
        portalBaseUrl,
        observedTxtValues,
      }),
    };
  },
);

mount(
  portalDomainsRouter,
  PREFIX,
  portalDomainEndpoints.create,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c, { body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const input = body;
    const hostname = sanitizePortalHostname(input.hostname);

    if (!hostname) {
      throw invalid(
        "invalid_request",
        "Hostname inválido para domínio personalizado",
      );
    }

    const collision = await findPortalHostnameOwnedByOtherOrganization(
      hostname,
      member.organizationId,
    );

    if (collision) {
      throw conflict(
        "portal_domain_in_use",
        "Este domínio já está em uso por outra organização",
      );
    }

    const existing = await getOrganizationCustomDomain(member.organizationId);
    const verificationToken = createPortalDomainVerificationToken();

    if (existing) {
      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const [row] = await ctx.o
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

          if (row) {
            await writeOrganizationAuditEvent(
              {
                organizationId: member.organizationId,
                actorUserId: session.user.id,
                actorMemberId: member.id,
                action: "portal_domain.updated",
                entityType: "portal_domain",
                entityId: row.id,
                details: {
                  hostname: row.hostname,
                  verificationHost: buildPortalDomainVerificationHost(
                    row.hostname,
                  ),
                  previousHostname: existing.hostname,
                },
              },
              ctx.o,
            );
          }
          return row;
        },
      );

      return { domain: serializeDomain(updated || null) };
    }

    const created = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [row] = await ctx.o
          .insert(organizationCustomDomain)
          .values({
            id: crypto.randomUUID(),
            organizationId: member.organizationId,
            hostname,
            verificationToken,
            createdBy: session.user.id,
          })
          .returning();

        if (row) {
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "portal_domain.created",
              entityType: "portal_domain",
              entityId: row.id,
              details: {
                hostname: row.hostname,
                verificationHost: buildPortalDomainVerificationHost(
                  row.hostname,
                ),
              },
            },
            ctx.o,
          );
        }
        return row;
      },
    );

    // 201 for a new domain: a status the definition (200) does not describe.
    return c.json({ domain: serializeDomain(created || null) }, 201);
  },
);

mount(
  portalDomainsRouter,
  PREFIX,
  portalDomainEndpoints.verify,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const record = await getOrganizationCustomDomain(member.organizationId);

    if (!record) {
      throw notFound(
        "portal_domain_not_configured",
        "Nenhum domínio configurado",
      );
    }

    const answers = await fetchTxtAnswers(
      buildPortalDomainVerificationHost(record.hostname),
    );
    const verified = answers.includes(record.verificationToken);

    if (!verified) {
      throw invalid(
        "portal_domain_txt_not_found",
        "Registro TXT ainda não propagado ou token incorreto",
        {
          legacyBody: {
            verification: {
              host: buildPortalDomainVerificationHost(record.hostname),
              value: record.verificationToken,
            },
          },
        },
      );
    }

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [row] = await ctx.o
          .update(organizationCustomDomain)
          .set({
            verifiedAt: record.verifiedAt ?? new Date(),
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(organizationCustomDomain.id, record.id))
          .returning();

        if (row) {
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "portal_domain.verified",
              entityType: "portal_domain",
              entityId: row.id,
              details: {
                hostname: row.hostname,
                verificationHost: buildPortalDomainVerificationHost(
                  row.hostname,
                ),
              },
            },
            ctx.o,
          );
        }
        return row;
      },
    );

    return { domain: serializeDomain(updated ?? null) };
  },
);

mount(
  portalDomainsRouter,
  PREFIX,
  portalDomainEndpoints.activate,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const record = await getOrganizationCustomDomain(member.organizationId);

    if (!record) {
      throw notFound(
        "portal_domain_not_configured",
        "Nenhum domínio configurado",
      );
    }

    if (!record.verifiedAt) {
      throw invalid(
        "portal_domain_not_verified",
        "Verifique o domínio antes de ativá-lo",
      );
    }

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [row] = await ctx.o
          .update(organizationCustomDomain)
          .set({
            isActive: true,
            activatedAt: record.activatedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(organizationCustomDomain.id, record.id))
          .returning();

        if (row) {
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "portal_domain.activated",
              entityType: "portal_domain",
              entityId: row.id,
              details: {
                hostname: row.hostname,
              },
            },
            ctx.o,
          );
        }
        return row;
      },
    );

    return { domain: serializeDomain(updated ?? null) };
  },
);

mount(
  portalDomainsRouter,
  PREFIX,
  portalDomainEndpoints.delete,
  [
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const record = await getOrganizationCustomDomain(member.organizationId);

    if (!record) {
      return { success: true as const };
    }

    await withOrg(member.organizationId, requestActor(c), async (ctx) => {
      await ctx.o
        .delete(organizationCustomDomain)
        .where(eq(organizationCustomDomain.id, record.id));

      await writeOrganizationAuditEvent(
        {
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "portal_domain.deleted",
          entityType: "portal_domain",
          entityId: record.id,
          details: {
            hostname: record.hostname,
            wasVerified: Boolean(record.verifiedAt),
            wasActive: record.isActive,
          },
        },
        ctx.o,
      );
    });

    return { success: true as const };
  },
);
