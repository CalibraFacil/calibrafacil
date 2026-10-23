import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  calibrationJob,
  certificateRelease,
  certificateReleasePolicy,
  customer,
  serviceOrder,
  serviceOrderCertificateLink,
  user,
} from "@calibra-facil/db/schema";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildUnitScopeCondition } from "../../lib/units";
import { agreementBelongsToOrganization } from "../../lib/tenant-refs";
import { orgDb } from "../../lib/org-db";
import { isUniqueViolationOf } from "../../lib/db-errors";
import {
  recomputeCertificateRelease,
  releaseByException,
} from "../../lib/certificate-release";
import type { CertificateReleasePolicyMode } from "@calibra-facil/shared";

const JobIdParamSchema = z.object({
  calibrationJobId: z.coerce.number().int().positive(),
});

/** Partial unique index: one organization-wide default policy (migration 0029). */
const ORG_DEFAULT_POLICY_INDEX = "certificate_release_policy_org_default_uidx";

const PolicyIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const POLICY_MODES = [
  "release_after_invoice",
  "release_after_first_installment",
  "release_after_full_payment",
  "trusted_customer",
  "manual_only",
] as const satisfies readonly CertificateReleasePolicyMode[];

const ReleaseByExceptionSchema = z.object({
  reason: z
    .string()
    .min(1, "Reason is required")
    .max(500)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "Reason is required"),
});

const PolicyModeSchema = z.enum(POLICY_MODES);

const CreatePolicySchema = z.object({
  mode: PolicyModeSchema,
  customerId: z.number().int().positive().nullable().optional(),
  commercialAgreementId: z.number().int().positive().nullable().optional(),
  serviceCategory: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value?.trim() || null)),
  priority: z.number().int().min(0).max(1000).optional(),
});

const UpdatePolicySchema = z.object({
  mode: PolicyModeSchema.optional(),
  archived: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

type PolicyMode = (typeof POLICY_MODES)[number];

interface PolicyDTO {
  id: number;
  mode: PolicyMode;
  customerId: number | null;
  customerName: string | null;
  commercialAgreementId: number | null;
  serviceCategory: string | null;
  priority: number;
  scope: "customer" | "agreement" | "service" | "organization";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function policyScope(row: {
  customerId: number | null;
  commercialAgreementId: number | null;
  serviceCategory: string | null;
}): PolicyDTO["scope"] {
  if (row.customerId !== null) return "customer";
  if (row.commercialAgreementId !== null) return "agreement";
  if (row.serviceCategory !== null) return "service";
  return "organization";
}

async function loadJobInOrgScope(
  o: OrgDb,
  params: {
    organizationId: string;
    calibrationJobId: number;
    scope: Parameters<typeof buildUnitScopeCondition>[1];
  },
) {
  const [row] = await o
    .select({
      jobId: calibrationJob.id,
      jobStatus: calibrationJob.status,
      orgId: calibrationJob.organizationId,
      customerId: calibrationJob.customerId,
      serviceOrderId: serviceOrder.id,
      serviceOrderUnitId: serviceOrder.unitId,
    })
    .from(calibrationJob)
    .leftJoin(
      serviceOrderCertificateLink,
      eq(serviceOrderCertificateLink.certificateJobId, calibrationJob.id),
    )
    .leftJoin(
      serviceOrder,
      eq(serviceOrder.id, serviceOrderCertificateLink.serviceOrderId),
    )
    .where(
      and(
        eq(calibrationJob.organizationId, params.organizationId),
        eq(calibrationJob.id, params.calibrationJobId),
      ),
    )
    .limit(1);

  if (!row) return null;

  // If the job is linked to a service order, enforce the caller's unit scope
  // against the SO's unit. A job that is somehow unlinked to any SO must
  // belong to a unit the caller can reach; here we conservatively require the
  // link to exist and resolve through it.
  if (row.serviceOrderUnitId == null) {
    return null;
  }
  const unitOk = (() => {
    if (params.scope.selectedUnitScope === "all") {
      return params.scope.accessibleUnitIds.includes(row.serviceOrderUnitId);
    }
    return params.scope.activeUnitId === row.serviceOrderUnitId;
  })();
  if (!unitOk) return null;

  return row;
}

async function loadReleaseDto(o: OrgDb, calibrationJobId: number) {
  const [release] = await o
    .select({
      id: certificateRelease.id,
      status: certificateRelease.status,
      appliedPolicyId: certificateRelease.appliedPolicyId,
      lastEvaluatedAt: certificateRelease.lastEvaluatedAt,
      paymentStateSnapshot: certificateRelease.paymentStateSnapshot,
      releasedByUserId: certificateRelease.releasedByUserId,
      releaseReason: certificateRelease.releaseReason,
      releasedByUserName: user.name,
    })
    .from(certificateRelease)
    .leftJoin(user, eq(user.id, certificateRelease.releasedByUserId))
    .where(eq(certificateRelease.calibrationJobId, calibrationJobId))
    .limit(1);

  if (!release) return null;

  let policy: { id: number; mode: PolicyMode } | null = null;
  if (release.appliedPolicyId !== null) {
    const [policyRow] = await o
      .select({
        id: certificateReleasePolicy.id,
        mode: certificateReleasePolicy.mode,
      })
      .from(certificateReleasePolicy)
      .where(eq(certificateReleasePolicy.id, release.appliedPolicyId))
      .limit(1);
    if (policyRow) policy = policyRow;
  }

  return {
    status: release.status,
    appliedPolicy: policy,
    paymentState: release.paymentStateSnapshot,
    lastEvaluatedAt: release.lastEvaluatedAt.toISOString(),
    releasedByUserName: release.releasedByUserName ?? null,
    releaseReason: release.releaseReason ?? null,
  };
}

export const financeCertificateReleaseRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // -------------------------------------------------------------------------
  // GET /api/finance/certificate-releases/:calibrationJobId
  // -------------------------------------------------------------------------
  .get(
    "/:calibrationJobId",
    ...withLabPermission({ financial: ["read"] }),
    zValidator("param", JobIdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { calibrationJobId } = c.req.valid("param");

      const result = await orgDb(member.organizationId).transaction(
        async (o) => {
          const job = await loadJobInOrgScope(o, {
            organizationId: member.organizationId,
            calibrationJobId,
            scope: member,
          });
          if (!job) return { status: "job_not_found" as const };

          // Recompute defensively so callers see fresh state without waiting
          // for the next reconciliation poll. Recompute is read-only with
          // respect to calibration_job.status and issued_certificate_snapshot.
          await recomputeCertificateRelease(
            {
              organizationId: member.organizationId,
              calibrationJobId,
              source: "system_reconciliation",
              actorUserId: null,
            },
            o,
          );

          const dto = await loadReleaseDto(o, calibrationJobId);
          if (!dto) return { status: "not_calculated" as const };
          return { status: "ok" as const, dto };
        },
      );
      if (result.status === "job_not_found") {
        return c.json({ error: "Certificado não encontrado" }, 404);
      }
      if (result.status === "not_calculated") {
        return c.json({ error: "Liberação ainda não calculada" }, 404);
      }
      return c.json({ data: result.dto });
    },
  )
  // -------------------------------------------------------------------------
  // POST /api/finance/certificate-releases/:calibrationJobId/release-by-exception
  // -------------------------------------------------------------------------
  .post(
    "/:calibrationJobId/release-by-exception",
    ...withLabPermission({ financial: ["export"] }),
    zValidator("param", JobIdParamSchema),
    zValidator("json", ReleaseByExceptionSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { calibrationJobId } = c.req.valid("param");
      const { reason } = c.req.valid("json");

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const job = await loadJobInOrgScope(o, {
            organizationId: member.organizationId,
            calibrationJobId,
            scope: member,
          });
          if (!job) return { status: "job_not_found" as const };

          const result = await releaseByException(
            {
              organizationId: member.organizationId,
              calibrationJobId,
              actorUserId: session.user.id,
              reason,
            },
            o,
          );

          if ("code" in result) {
            return { status: "refused" as const, code: result.code };
          }

          const dto = await loadReleaseDto(o, calibrationJobId);
          return { status: "released" as const, dto };
        },
      );

      if (outcome.status === "job_not_found") {
        return c.json({ error: "Certificado não encontrado" }, 404);
      }
      if (outcome.status === "refused") {
        if (outcome.code === "REASON_REQUIRED") {
          return c.json({ error: "Motivo é obrigatório" }, 400);
        }
        if (outcome.code === "NOT_APPROVED") {
          return c.json({ error: "Certificado ainda não aprovado" }, 409);
        }
        return c.json({ error: "Certificado não encontrado" }, 404);
      }

      if (!outcome.dto) {
        return c.json({ error: "Liberação não disponível" }, 500);
      }
      return c.json({ data: outcome.dto });
    },
  );

// ---------------------------------------------------------------------------
// Settings router for org-level policy CRUD. Mounted under /api/settings.
// ---------------------------------------------------------------------------

export const settingsCertificateReleasePolicyRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
    const member = c.get("member");
    const rows = await orgDb(member.organizationId).transaction((o) =>
      o
        .select({
          id: certificateReleasePolicy.id,
          mode: certificateReleasePolicy.mode,
          customerId: certificateReleasePolicy.customerId,
          customerName: customer.name,
          commercialAgreementId: certificateReleasePolicy.commercialAgreementId,
          serviceCategory: certificateReleasePolicy.serviceCategory,
          priority: certificateReleasePolicy.priority,
          archivedAt: certificateReleasePolicy.archivedAt,
          createdAt: certificateReleasePolicy.createdAt,
          updatedAt: certificateReleasePolicy.updatedAt,
        })
        .from(certificateReleasePolicy)
        .leftJoin(
          customer,
          eq(customer.id, certificateReleasePolicy.customerId),
        )
        .where(
          eq(certificateReleasePolicy.organizationId, member.organizationId),
        )
        .orderBy(certificateReleasePolicy.id),
    );

    const data: PolicyDTO[] = rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      customerId: row.customerId,
      customerName: row.customerName ?? null,
      commercialAgreementId: row.commercialAgreementId,
      serviceCategory: row.serviceCategory,
      priority: row.priority,
      scope: policyScope(row),
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return c.json({ data });
  })
  .post(
    "/",
    ...withLabPermission({ financial: ["contract_create"] }),
    zValidator("json", CreatePolicySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const body = c.req.valid("json");

      // The partial unique index is the authority: a second org-wide default
      // (customer, agreement and category all null) violates it, also when two
      // requests race. Map that one index to 409 instead of a 500. The violation
      // aborts the transaction, so it is caught outside it.
      const outcome = await orgDb(member.organizationId)
        .transaction(async (o) => {
          // Restrict customer / agreement override creation to entities inside
          // the caller's organization (no cross-tenant leak via FK fishing).
          if (body.customerId != null) {
            const [matched] = await o
              .select({ id: customer.id })
              .from(customer)
              .where(
                and(
                  eq(customer.id, body.customerId),
                  eq(customer.labOrganizationId, member.organizationId),
                ),
              )
              .limit(1);
            if (!matched) return { status: "invalid_customer" as const };
          }

          // Same cross-tenant guard for the agreement the override is pinned to.
          if (
            body.commercialAgreementId != null &&
            !(await agreementBelongsToOrganization(
              member.organizationId,
              body.commercialAgreementId,
              o,
            ))
          ) {
            return { status: "invalid_agreement" as const };
          }

          const rows = await o
            .insert(certificateReleasePolicy)
            .values({
              organizationId: member.organizationId,
              mode: body.mode,
              customerId: body.customerId ?? null,
              commercialAgreementId: body.commercialAgreementId ?? null,
              serviceCategory: body.serviceCategory ?? null,
              priority: body.priority ?? 0,
              createdByUserId: session.user.id,
            })
            .returning();
          return { status: "ok" as const, rows };
        })
        .catch((error: unknown) => {
          if (isUniqueViolationOf(error, ORG_DEFAULT_POLICY_INDEX)) {
            return { status: "duplicate_default" as const };
          }
          throw error;
        });
      if (outcome.status === "invalid_customer") {
        return c.json({ error: "Cliente inválido" }, 400);
      }
      if (outcome.status === "invalid_agreement") {
        return c.json({ error: "Contrato inválido" }, 400);
      }
      if (outcome.status === "duplicate_default") {
        return c.json(
          { error: "Já existe uma política padrão para a organização" },
          409,
        );
      }

      const created = outcome.rows[0];
      if (!created) return c.json({ error: "Falha ao criar política" }, 500);

      return c.json({
        data: {
          id: created.id,
          mode: created.mode,
          customerId: created.customerId,
          commercialAgreementId: created.commercialAgreementId,
          serviceCategory: created.serviceCategory,
          priority: created.priority,
          scope: policyScope(created),
          archivedAt: created.archivedAt
            ? created.archivedAt.toISOString()
            : null,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      });
    },
  )
  .put(
    "/:id",
    ...withLabPermission({ financial: ["contract_update"] }),
    zValidator("param", PolicyIdParamSchema),
    zValidator("json", UpdatePolicySchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const [existing] = await o
            .select({
              id: certificateReleasePolicy.id,
              customerId: certificateReleasePolicy.customerId,
              commercialAgreementId:
                certificateReleasePolicy.commercialAgreementId,
              serviceCategory: certificateReleasePolicy.serviceCategory,
            })
            .from(certificateReleasePolicy)
            .where(
              and(
                eq(certificateReleasePolicy.id, id),
                eq(
                  certificateReleasePolicy.organizationId,
                  member.organizationId,
                ),
              ),
            )
            .limit(1);
          if (!existing) return { status: "not_found" as const };

          const isOrgDefault =
            existing.customerId === null &&
            existing.commercialAgreementId === null &&
            existing.serviceCategory === null;
          if (isOrgDefault && body.archived === true) {
            return { status: "default_not_archivable" as const };
          }

          await o
            .update(certificateReleasePolicy)
            .set({
              ...(body.mode !== undefined ? { mode: body.mode } : {}),
              ...(body.priority !== undefined
                ? { priority: body.priority }
                : {}),
              ...(body.archived === true ? { archivedAt: new Date() } : {}),
              ...(body.archived === false ? { archivedAt: null } : {}),
              updatedAt: new Date(),
            })
            .where(eq(certificateReleasePolicy.id, id));

          return { status: "ok" as const };
        },
      );
      if (outcome.status === "not_found") {
        return c.json({ error: "Política não encontrada" }, 404);
      }
      if (outcome.status === "default_not_archivable") {
        return c.json(
          { error: "Política padrão da organização não pode ser arquivada" },
          400,
        );
      }

      return c.json({ data: { id } });
    },
  );
