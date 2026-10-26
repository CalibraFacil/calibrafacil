import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  ExecuteJobSchema,
  SubmitForReviewSchema,
} from "@calibra-facil/schemas";
import {
  buildPublicApiError,
  getPublicApiRequestIp,
  getResourceExternalId,
  upsertResourceExternalId,
} from "../../lib/public-api";
import {
  emitPublicApiWebhookEvent,
  stagePublicApiWebhookEvent,
} from "../../lib/public-api-webhooks";
import { requireApiScope } from "../../middleware/api-key-auth";
import { createCalibrationJob, jobCreationClientErrors } from "../../lib/jobs";
import { notifyJobAssigned } from "@calibra-facil/notifications";
import { executeJob, submitJob } from "../../modules/jobs/submit-job";
import { editJob } from "../../modules/jobs/edit-job";
import { type PublicApiV2Env } from "./env";
import { JobCreatePublicSchema, PublicUpdateJobSchema } from "./schemas";
import { withIdempotentCommand, withIdempotentMutation } from "./idempotency";
import {
  resolveAssetId,
  resolveExternalResourceId,
  resolveUnitIdForWrite,
} from "./resolvers";
import {
  jobStatusConflictBody,
  publicApiJobActor,
  publicApiJobExecutionRefusal,
} from "./job-support";

export const jobWriteRoutes = new Hono<PublicApiV2Env>()
  .post(
    "/jobs",
    requireApiScope("jobs:write"),
    zValidator("json", JobCreatePublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(
        c,
        input,
        async ({ o, tx, afterCommit }) => {
          const assetId = await resolveAssetId(
            {
              organizationId: apiKey.organizationId,
              assetId: input.assetId,
              assetExternalId: input.assetExternalId,
            },
            o,
          );

          if (!assetId) {
            return {
              status: 404,
              body: buildPublicApiError({
                code: "asset_not_found",
                message: "Ativo não encontrado",
              }),
            };
          }

          const unitId = await resolveUnitIdForWrite(
            {
              organizationId: apiKey.organizationId,
              requestedUnitId: input.unitId,
            },
            o,
          );

          // The job, its audit entry and the caller's external id commit
          // together (and with the idempotency record). A refusal of the
          // creation throws and is answered by `mapError`, after the rollback.
          const created = await createCalibrationJob({
            organizationId: apiKey.organizationId,
            unitId,
            createdBy: apiKey.createdBy,
            assetId,
            serviceId: input.serviceId,
            technicianId: input.technicianId,
            dueDate: input.dueDate,
            ipAddress: getPublicApiRequestIp(c.req.raw.headers),
            executor: tx,
            // The assignment notification waits for the commit: a technician
            // is never told about a job that rolled back.
            notifyOnAssignment: false,
          });

          const externalId = input.externalId?.trim();
          if (externalId) {
            await upsertResourceExternalId(
              {
                organizationId: apiKey.organizationId,
                apiKeyId: apiKey.id,
                resourceType: "job",
                resourceId: created.id,
                externalId,
              },
              o,
            );
          }

          const body = {
            data: {
              id: created.id,
              jobId: created.jobId,
              status: created.status,
              dueDate: created.dueDate,
              externalId: externalId ?? null,
            },
          };

          if (input.technicianId) {
            const technicianId = input.technicianId;
            afterCommit(async () => {
              try {
                await notifyJobAssigned(
                  created.id,
                  technicianId,
                  apiKey.createdBy,
                );
              } catch (error) {
                console.error(
                  "[Jobs] Failed to send assignment notification:",
                  error,
                );
              }
            });
          }
          await stagePublicApiWebhookEvent(
            { o, tx, afterCommit },
            {
              organizationId: apiKey.organizationId,
              eventType: "job.created",
              payload: body.data,
            },
          );

          return {
            status: 201,
            body,
            resourceType: "job" as const,
            resourceId: created.id,
          };
        },
        {
          mapError: (error) => {
            const message =
              error instanceof Error ? error.message : "Falha ao criar OS";
            return {
              status: jobCreationClientErrors.has(message) ? 400 : 500,
              body: buildPublicApiError({
                code: "job_create_failed",
                message,
              }),
            };
          },
        },
      );
    },
  )
  .patch(
    "/jobs/:id",
    requireApiScope("jobs:write"),
    zValidator("json", PublicUpdateJobSchema),
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

      // Transport only: the policy is `editJob` (the same command the cloud
      // PUT runs).
      const result = await editJob({
        actor: publicApiJobActor(apiKey, c.req.raw.headers),
        jobId: resolvedId,
        organizationId: apiKey.organizationId,
        unitScope: null,
        technicianId: input.technicianId,
        dueDate: input.dueDate,
      });
      switch (result.status) {
        case "not_found":
          return c.json(
            buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
            404,
          );
        case "illegal_transition":
          return c.json(
            buildPublicApiError({
              code: result.error.code,
              message: `Não é possível atualizar uma OS com status ${result.currentStatus}`,
            }),
            409,
          );
        case "technician_not_found":
          return c.json(
            buildPublicApiError({
              code: result.error.code,
              message: "Técnico não encontrado ou sem permissão",
            }),
            400,
          );
        case "competence_missing":
          return c.json(
            buildPublicApiError({
              code: result.error.code,
              message: result.error.message,
            }),
            422,
          );
        case "concurrent_update":
          return c.json(jobStatusConflictBody(), 409);
        case "ok":
          break;
      }
      const updated = result.job;

      const externalId = input.externalId?.trim();
      if (externalId) {
        await upsertResourceExternalId({
          organizationId: apiKey.organizationId,
          apiKeyId: apiKey.id,
          resourceType: "job",
          resourceId: resolvedId,
          externalId,
        });
      }

      const body = {
        data: {
          ...updated,
          externalId:
            externalId ??
            (await getResourceExternalId({
              organizationId: apiKey.organizationId,
              resourceType: "job",
              resourceId: resolvedId,
            })),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "job.updated",
        payload: body.data,
      });

      return c.json(body);
    },
  )
  .post(
    "/jobs/:id/results",
    requireApiScope("jobs:write"),
    zValidator("json", ExecuteJobSchema),
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
        // Transport only: the policy is `executeJob` (the same command the
        // cloud route and the desktop sync run). The results the client sent
        // are not stored; they are recomputed from the data.
        const result = await executeJob({
          actor: publicApiJobActor(apiKey, c.req.raw.headers),
          jobId: resolvedId,
          organizationId: apiKey.organizationId,
          unitScope: null,
          data: input.data,
          clientResults: input.results,
          performedAt: input.performedAt,
          selectedStandardIds: input.selectedStandardIds,
          environment: input.environment,
          calibrationLocation: input.calibrationLocation,
          calibrationPhases: input.calibrationPhases,
          methodDeviations: input.methodDeviations,
        });
        if (result.status !== "ok") {
          return publicApiJobExecutionRefusal(
            result,
            "A OS não aceita atualização de resultados neste status",
          );
        }

        const updated = result.job;
        // `warnings`: standards of the saved snapshot that went stale; the
        // results are saved, the submit will refuse until they are replaced.
        const body = { data: updated, warnings: result.warnings };

        afterCommit(() =>
          emitPublicApiWebhookEvent({
            organizationId: apiKey.organizationId,
            eventType: "job.results_submitted",
            payload: body.data,
          }),
        );

        return {
          status: 200,
          body,
          resourceType: "job" as const,
          resourceId: updated.id,
        };
      });
    },
  )
  .post(
    "/jobs/:id/submit",
    requireApiScope("jobs:write"),
    zValidator("json", SubmitForReviewSchema),
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
        // Transport only: the policy is `submitJob`, the very command the
        // cloud route and the desktop sync run (official calculation, scope,
        // competence, environment, backdate and standards rules).
        const result = await submitJob({
          actor: publicApiJobActor(apiKey, c.req.raw.headers),
          jobId: resolvedId,
          organizationId: apiKey.organizationId,
          unitScope: null,
          data: input.data,
          clientResults: input.results,
          performedAt: input.performedAt,
          backdateReason: input.backdateReason,
          selectedStandardIds: input.selectedStandardIds,
          environment: input.environment,
          calibrationLocation: input.calibrationLocation,
          calibrationPhases: input.calibrationPhases,
        });
        if (result.status !== "ok") {
          return publicApiJobExecutionRefusal(
            result,
            "A OS não pode ser submetida neste status",
          );
        }

        return {
          status: 200,
          body: { data: result.job },
          resourceType: "job" as const,
          resourceId: result.job.id,
        };
      });
    },
  );
