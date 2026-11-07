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
import {
  conflict,
  DomainError,
  invalid,
  notFound,
} from "../../lib/domain-errors";
import { withOrg } from "../../lib/org-context";
import { orgDb } from "../../lib/org-db";
import { isUniqueViolationOf } from "../../lib/db-errors";
import { requestActor } from "../../middleware/request-actor";
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

      // Not read-only for the record: the release is recomputed (and its audit
      // row written) in this transaction, so it is a write on the one door.
      const dto = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const job = await loadJobInOrgScope(ctx.o, {
            organizationId: member.organizationId,
            calibrationJobId,
            scope: member,
          });
          if (!job) {
            throw notFound(
              "certificate_not_found",
              "Certificado não encontrado",
            );
          }

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
            ctx.o,
          );

          const loaded = await loadReleaseDto(ctx.o, calibrationJobId);
          if (!loaded) {
            throw notFound(
              "release_not_calculated",
              "Liberação ainda não calculada",
            );
          }
          return loaded;
        },
      );
      return c.json({ data: dto });
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
      const { calibrationJobId } = c.req.valid("param");
      const { reason } = c.req.valid("json");

      const dto = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const job = await loadJobInOrgScope(ctx.o, {
            organizationId: member.organizationId,
            calibrationJobId,
            scope: member,
          });
          if (!job) {
            throw notFound(
              "certificate_not_found",
              "Certificado não encontrado",
            );
          }

          const result = await releaseByException(
            {
              organizationId: member.organizationId,
              calibrationJobId,
              actorUserId: ctx.actor.userId,
              reason,
            },
            ctx.o,
          );

          if ("code" in result) {
            if (result.code === "REASON_REQUIRED") {
              throw invalid("release_reason_required", "Motivo é obrigatório");
            }
            if (result.code === "NOT_APPROVED") {
              throw conflict(
                "release_certificate_not_approved",
                "Certificado ainda não aprovado",
              );
            }
            throw notFound(
              "certificate_not_found",
              "Certificado não encontrado",
            );
          }

          const loaded = await loadReleaseDto(ctx.o, calibrationJobId);
          if (!loaded) {
            throw new DomainError({
              code: "release_unavailable",
              status: 500,
              message: "Liberação não disponível",
            });
          }
          return loaded;
        },
      );

      return c.json({ data: dto });
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
      const body = c.req.valid("json");

      // The partial unique index is the authority: a second org-wide default
      // (customer, agreement and category all null) violates it, also when two
      // requests race. Map that one index to 409 instead of a 500. The violation
      // aborts the transaction, so it is caught outside it.
      const created = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          // Restrict customer / agreement override creation to entities inside
          // the caller's organization (no cross-tenant leak via FK fishing).
          if (body.customerId != null) {
            const [matched] = await ctx.o
              .select({ id: customer.id })
              .from(customer)
              .where(
                and(
                  eq(customer.id, body.customerId),
                  eq(customer.labOrganizationId, member.organizationId),
                ),
              )
              .limit(1);
            if (!matched) {
              throw invalid("rule_customer_invalid", "Cliente inválido");
            }
          }

          // Same cross-tenant guard for the agreement the override is pinned to.
          if (
            body.commercialAgreementId != null &&
            !(await agreementBelongsToOrganization(
              member.organizationId,
              body.commercialAgreementId,
              ctx.o,
            ))
          ) {
            throw invalid("rule_agreement_invalid", "Contrato inválido");
          }

          const [row] = await ctx.o
            .insert(certificateReleasePolicy)
            .values({
              organizationId: member.organizationId,
              mode: body.mode,
              customerId: body.customerId ?? null,
              commercialAgreementId: body.commercialAgreementId ?? null,
              serviceCategory: body.serviceCategory ?? null,
              priority: body.priority ?? 0,
              createdByUserId: ctx.actor.userId,
            })
            .returning();
          if (!row) throw new Error("Falha ao criar política");
          return row;
        },
      ).catch((error: unknown) => {
        if (isUniqueViolationOf(error, ORG_DEFAULT_POLICY_INDEX)) {
          throw conflict(
            "release_policy_default_exists",
            "Já existe uma política padrão para a organização",
          );
        }
        throw error;
      });

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

      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        const [existing] = await ctx.o
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
        if (!existing) {
          throw notFound("release_policy_not_found", "Política não encontrada");
        }

        const isOrgDefault =
          existing.customerId === null &&
          existing.commercialAgreementId === null &&
          existing.serviceCategory === null;
        if (isOrgDefault && body.archived === true) {
          throw invalid(
            "release_policy_default_not_archivable",
            "Política padrão da organização não pode ser arquivada",
          );
        }

        await ctx.o
          .update(certificateReleasePolicy)
          .set({
            ...(body.mode !== undefined ? { mode: body.mode } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.archived === true ? { archivedAt: new Date() } : {}),
            ...(body.archived === false ? { archivedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(certificateReleasePolicy.id, id));
      });

      return c.json({ data: { id } });
    },
  );
