import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { calibrationJob } from "@calibra-facil/db/schema";
import {
  ApproveJobSchema,
  CancelJobSchema,
  RejectJobSchema,
} from "@calibra-facil/schemas";
import { and, eq } from "drizzle-orm";
import {
  buildPublicApiError,
  getPublicApiRequestIp,
} from "../../lib/public-api";
import { emitPublicApiWebhookEvent } from "../../lib/public-api-webhooks";
import { requireApiScope } from "../../middleware/api-key-auth";
import { approveJob } from "../../modules/jobs/approve-job";
import { cancelJob } from "../../modules/jobs/cancel-job";
import { rejectJob } from "../../modules/jobs/reject-job";
import { resolveApiKeyApprover } from "../../lib/api-key-approver";
import { sendServiceOrdersToFinance } from "../../lib/finance";
import { type PublicApiV2Env } from "./env";
import { resolveExternalResourceId } from "./resolvers";
import { withIdempotentCommand } from "./idempotency";
import { jobStatusConflictBody, publicApiJobActor } from "./job-support";
import { orgDb } from "../../lib/org-db";

export const jobDecisionRoutes = new Hono<PublicApiV2Env>()
  .post(
    "/jobs/:id/approve",
    requireApiScope("jobs:write"),
    zValidator("json", ApproveJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentCommand(c, input, async (afterCommit) => {
        const [job] = await orgDb(apiKey.organizationId).transaction((o) =>
          o
            .select({ unitId: calibrationJob.unitId })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.id, resolvedId),
                eq(calibrationJob.organizationId, apiKey.organizationId),
              ),
            )
            .limit(1),
        );

        if (!job) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
          };
        }

        // Approval is a regulated release (ISO/IEC 17025 §6.2.6) and a key is
        // a credential, not a person: it acts FOR its creator, who is the
        // accountable approver. The creator's current role, unit scope,
        // signatory authorization and separation of duties are checked by the
        // same command the cloud route and the desktop sync use, and the audit
        // row records the key the approval went through.
        const approver = await resolveApiKeyApprover({
          organizationId: apiKey.organizationId,
          userId: apiKey.createdBy,
          unitId: job.unitId,
        });

        const result = await approveJob({
          jobId: resolvedId,
          actor: {
            kind: "api_key",
            apiKey: {
              id: apiKey.id,
              name: apiKey.name,
              keyPrefix: apiKey.keyPrefix,
            },
            member: approver,
          },
          values: input,
          metadata: { ipAddress: getPublicApiRequestIp(c) },
          completion: {
            kind: "generate_certificate_pdf",
            sendServiceOrdersToFinance: async (params) =>
              approver
                ? sendServiceOrdersToFinance({
                    ...params,
                    scope: approver,
                    env: c.env,
                  })
                : [],
          },
        });

        switch (result.status) {
          case "not_found":
            return {
              status: 404,
              body: buildPublicApiError({
                code: "job_not_found",
                message: "OS não encontrada",
              }),
            };
          case "invalid_status":
            return {
              status: 409,
              body: buildPublicApiError({
                code: "job_not_approvable",
                message: "A OS precisa estar em revisão para ser aprovada",
              }),
            };
          case "dispatch_failed":
            return {
              status: 503,
              body: buildPublicApiError({
                code: "approval_dispatch_failed",
                message:
                  "Não foi possível enfileirar a geração do certificado; a aprovação foi revertida. Tente novamente",
              }),
            };
          case "concurrent_approval":
            return {
              status: 409,
              body: buildPublicApiError({
                code: "approval_conflict",
                message:
                  "A OS foi alterada por outra aprovação ou revisão em andamento",
              }),
            };
          case "approval_requires_signatory":
          case "role_not_permitted":
          case "not_authorized_signatory":
            return {
              status: 403,
              body: buildPublicApiError({
                code: "approval_requires_signatory",
                message:
                  "O criador da chave de API precisa ser um signatário autorizado com permissão de aprovar calibrações",
              }),
            };
          case "self_approval_blocked":
            return {
              status: 403,
              body: buildPublicApiError({
                code: "self_approval_blocked",
                message:
                  "Separação de responsabilidades (ISO/IEC 17025): quem executou ou criou a calibração não pode aprová-la, nem por chave de API",
              }),
            };
          case "environmental_justification_required":
            return {
              status: 400,
              body: buildPublicApiError({
                code: "environmental_justification_required",
                message:
                  "Condições ambientais fora dos limites. Forneça environmentalJustification para aprovar",
                details: {
                  environmentalSnapshot: result.environmentalSnapshot,
                },
              }),
            };
          case "scope_violation":
            return {
              status: 422,
              body: buildPublicApiError({
                code: "scope_violation",
                message:
                  "Violação do escopo acreditado (CMC): a emissão acreditada está bloqueada. Aprove com scopeOverrideJustification para emitir sem o selo de acreditação",
                details: { scopeCompliance: result.scopeCompliance },
              }),
            };
          case "approved": {
            const updated = result.job;
            if (updated) {
              afterCommit(() =>
                emitPublicApiWebhookEvent({
                  organizationId: apiKey.organizationId,
                  eventType: "job.approved",
                  payload: {
                    id: updated.id,
                    jobId: updated.jobId,
                    status: updated.status,
                  },
                }),
              );
            }

            return {
              status: 200,
              body: { data: updated },
              resourceType: "job" as const,
              resourceId: updated?.id ?? resolvedId,
            };
          }
        }
      });
    },
  )
  .post(
    "/jobs/:id/reject",
    requireApiScope("jobs:write"),
    zValidator("json", RejectJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });
      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentCommand(c, input, async () => {
        // Transport only: the policy is `rejectJob` (the same command the
        // cloud route runs).
        const result = await rejectJob({
          actor: publicApiJobActor(apiKey, c),
          jobId: resolvedId,
          organizationId: apiKey.organizationId,
          unitScope: null,
          reason: input.reason,
        });
        switch (result.status) {
          case "not_found":
            return {
              status: 404,
              body: buildPublicApiError({
                code: "job_not_found",
                message: "OS não encontrada",
              }),
            };
          case "illegal_transition":
            return {
              status: 409,
              body: buildPublicApiError({
                code: result.error.code,
                message: "A OS precisa estar em revisão para ser rejeitada",
              }),
            };
          case "concurrent_update":
            return { status: 409, body: jobStatusConflictBody() };
          case "ok":
            return {
              status: 200,
              body: { data: result.job },
              resourceType: "job" as const,
              resourceId: result.job.id,
            };
        }
      });
    },
  )
  .delete(
    "/jobs/:id",
    requireApiScope("jobs:write"),
    zValidator("json", CancelJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });
      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentCommand(c, input, async (afterCommit) => {
        // Transport only: the policy is `cancelJob` (the same command the
        // cloud route and the visit's remove-job run).
        const result = await cancelJob({
          actor: publicApiJobActor(apiKey, c),
          jobId: resolvedId,
          organizationId: apiKey.organizationId,
          unitScope: null,
          reason: input.reason,
        });
        switch (result.status) {
          case "not_found":
            return {
              status: 404,
              body: buildPublicApiError({
                code: "job_not_found",
                message: "OS não encontrada",
              }),
            };
          case "illegal_transition":
            return {
              status: 409,
              body: buildPublicApiError({
                code: result.error.code,
                message:
                  result.currentStatus === "APPROVED"
                    ? "Não é possível cancelar uma OS aprovada"
                    : `Não é possível cancelar uma OS com status ${result.currentStatus}`,
              }),
            };
          case "concurrent_update":
            return { status: 409, body: jobStatusConflictBody() };
          case "ok":
            break;
        }
        const updated = result.job;

        afterCommit(() =>
          emitPublicApiWebhookEvent({
            organizationId: apiKey.organizationId,
            eventType: "job.canceled",
            payload: {
              id: updated.id,
              jobId: updated.jobId,
              status: updated.status,
            },
          }),
        );

        return {
          status: 200,
          body: { data: updated },
          resourceType: "job" as const,
          resourceId: updated.id,
        };
      });
    },
  );
