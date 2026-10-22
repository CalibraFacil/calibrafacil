import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  domainErrorBody,
  domainErrorResponse,
  invalid,
  notFound,
} from "../lib/domain-errors";
import {
  renderLabel,
  defaultRenderOptions,
} from "@calibra-facil/label-rendering";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { sendServiceOrdersToFinance } from "../lib/finance";
import type { IntegrationsEnv } from "../lib/integrations";
import {
  calibrationJob,
  jobAuditLog,
  asset,
  assetType,
  customer,
  organization,
  service,
  user,
  member,
  memberUnitAssignment,
  type AssetSnapshot,
} from "@calibra-facil/db/schema";
import {
  notifyJobSubmittedForReview,
  notifyJobRejected,
  notifyJobAssigned,
  notifyCertificateAmended,
} from "@calibra-facil/notifications";
import {
  CreateJobSchema,
  UpdateJobSchema,
  ListJobsQuerySchema,
  AssignTechnicianSchema,
  SubmitForReviewSchema,
  ApproveJobSchema,
  RejectJobSchema,
  CancelJobSchema,
  ExecuteJobSchema,
  AmendJobSchema,
  FlagJobOutOfToleranceSchema,
} from "@calibra-facil/schemas";
import type {
  JobAmendResponse,
  JobDetail,
  JobCreateResponse,
  JobDownloadUrlResponse,
  JobFlagOotResponse,
  JobGenerateLabelResponse,
  JobMutationResponse,
  JobTechniciansResponse,
  JobsListResponse,
  ServerShape,
} from "@calibra-facil/contracts";
import { flagJobOutOfTolerance } from "../lib/oot-notifications";
import { syncJobStandardLinks } from "../lib/job-standards";
import {
  addServerTiming,
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  addCalendarDays,
  isCalendarDatePast,
  labDaysUntil,
  labToday,
} from "@calibra-facil/shared";
import {
  eq,
  and,
  ilike,
  desc,
  count,
  lte,
  gte,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
} from "../lib/storage";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import { loadJobFinancialContexts } from "../lib/finance";
import { alias } from "drizzle-orm/pg-core";
import { getExecuteRows } from "../lib/db";
import { buildUnitScopeCondition } from "../lib/units";
import { parseLegacyNumericIdentifier } from "../lib/route-identifiers";
import {
  decodeRouteIdentifier,
  shouldUseLocalR2Download,
  r2EnvFromUnknown,
  methodSnapshotDisplay,
  buildLocalJobFileUrl,
} from "../modules/jobs/helpers";
import { approveJob } from "../modules/jobs/approve-job";
import { amendJob } from "../modules/jobs/amend-job";
import { assignJob } from "../modules/jobs/assign-job";
import { cancelJob } from "../modules/jobs/cancel-job";
import { editJob } from "../modules/jobs/edit-job";
import { rejectJob } from "../modules/jobs/reject-job";
import {
  executeJob,
  submitJob,
  type JobExecutionResult,
} from "../modules/jobs/submit-job";
import { jobStatusConflict } from "../modules/jobs/job-status-transitions";
import { certificateVerificationUrl } from "@calibra-facil/shared/public-urls";

// Aliases for multiple user joins
const approverUser = alias(user, "approverUser");
const rejectorUser = alias(user, "rejectorUser");

const CommandPaletteJobSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

async function resolveJobRouteId(
  identifier: string,
  memberData: AuthVariables["member"],
): Promise<number | null> {
  const routeIdentifier = decodeRouteIdentifier(identifier);
  const legacyId = parseLegacyNumericIdentifier(routeIdentifier);

  const [job] = await db
    .select({ id: calibrationJob.id })
    .from(calibrationJob)
    .where(
      and(
        legacyId
          ? or(
              eq(calibrationJob.id, legacyId),
              eq(calibrationJob.jobId, routeIdentifier),
            )
          : eq(calibrationJob.jobId, routeIdentifier),
        eq(calibrationJob.organizationId, memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, memberData),
      ),
    )
    .limit(1);

  return job?.id ?? null;
}

function jobNotFound() {
  return notFound("job_not_found", "Job nao encontrado");
}

/**
 * The HTTP answer to a submit/execute command that did not write: the
 * command's own refusal (code, status, pt-BR message), unchanged. Transport
 * mapping only.
 */
async function jobExecutionRefusalResponse(
  c: Context,
  jobId: number,
  result: Exclude<JobExecutionResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "not_found":
      return domainErrorResponse(c, jobNotFound());
    case "concurrent_update":
      return domainErrorResponse(c, await jobStatusConflict(jobId));
    case "official_execution_failed":
      // The 422 carries the method diagnostics next to the stable code.
      return c.newResponse(
        JSON.stringify({
          ...domainErrorBody(result.error),
          diagnostics: result.failure.diagnostics,
        }),
        result.error.status,
        { "Content-Type": "application/json" },
      );
    case "precondition_failed":
      return domainErrorResponse(c, invalid("invalid_request", result.reason));
    case "illegal_transition":
    case "status_payload_mismatch":
    case "invalid_performed_at":
    case "standards_refused":
    case "asset_unavailable":
    case "record_incomplete":
    case "competence_missing":
      return domainErrorResponse(c, result.error);
  }
}

/**
 * Calibration Jobs Router - Work Orders (ISO 17025 Operational Layer)
 *
 * The Job is the most critical entity in the system. It connects:
 * Customer + Asset + Service + Method into a single record of work.
 *
 * Key Design Decision: Method Snapshotting
 * - When a job is created, the Method configuration is FROZEN into the job
 * - This ensures future changes to the Method do not affect historical jobs
 * - Critical for ISO 17025 compliance: reproduce calculations exactly as performed
 *
 * Permissions:
 * - GET /: calibration:read (all roles)
 * - GET /:id: calibration:read (all roles)
 * - POST /: calibration:create (LAB only - operator, technician, admin, owner)
 * - PUT /:id: calibration:update (LAB only)
 * - DELETE /:id: calibration:delete (LAB only) - sets status to CANCELED
 * - POST /:id/assign: calibration:assign_technician (LAB only)
 * - POST /:id/execute: calibration:execute (LAB only)
 * - POST /:id/submit: calibration:submit (LAB only)
 * - POST /:id/approve: calibration:approve (admin, owner only)
 * - POST /:id/reject: calibration:reject (admin, owner only)
 */
export const jobsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>()
  // =========================================================================
  // GET /search - Lightweight search for command palette
  // =========================================================================
  .get(
    "/search",
    ...withLabPermission({ calibration: ["read"] }),
    zValidator("query", CommandPaletteJobSearchQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const { query, limit } = c.req.valid("query");

      try {
        const results = await db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            status: calibrationJob.status,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
              or(
                ilike(calibrationJob.jobId, `%${query}%`),
                ilike(calibrationJob.certificateName, `%${query}%`),
              )!,
            ),
          )
          .orderBy(desc(calibrationJob.createdAt))
          .limit(limit);

        return c.json(results);
      } catch (error) {
        console.error("Error searching jobs:", error);
        return c.json({ error: "Erro ao buscar ordens de serviço" }, 500);
      }
    },
  )

  // =========================================================================
  // GET / - List jobs with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ calibration: ["read"] }),
    zValidator("query", ListJobsQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const {
        page,
        limit,
        query,
        status,
        customerId,
        assetId,
        serviceId,
        technicianId,
        dateFrom,
        dateTo,
        dueSoon,
        overdue,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;

      // Build conditions - always scope to organization
      const conditions = [
        eq(calibrationJob.organizationId, memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, memberData),
      ];

      if (query) {
        conditions.push(
          or(
            ilike(calibrationJob.jobId, `%${query}%`),
            ilike(calibrationJob.certificateName, `%${query}%`),
          )!,
        );
      }

      if (status) {
        conditions.push(eq(calibrationJob.status, status));
      }

      if (customerId) {
        conditions.push(eq(calibrationJob.customerId, customerId));
      }

      if (assetId) {
        conditions.push(eq(calibrationJob.assetId, assetId));
      }

      if (serviceId) {
        conditions.push(eq(calibrationJob.serviceId, serviceId));
      }

      if (technicianId) {
        conditions.push(eq(calibrationJob.technicianId, technicianId));
      }

      if (dateFrom) {
        conditions.push(gte(calibrationJob.createdAt, new Date(dateFrom)));
      }

      if (dateTo) {
        conditions.push(lte(calibrationJob.createdAt, new Date(dateTo)));
      }

      // Filter jobs due within 7 days. due_date is a calendar day: compare it
      // with the laboratory's days (today .. today + 7), both inclusive.
      if (dueSoon) {
        const today = labToday();
        conditions.push(gte(calibrationJob.dueDate, today));
        conditions.push(lte(calibrationJob.dueDate, addCalendarDays(today, 7)));
      }

      // Filter overdue jobs: due before today in the laboratory (a job due
      // today is not overdue until the day is over).
      if (overdue) {
        conditions.push(lt(calibrationJob.dueDate, labToday()));
        conditions.push(
          inArray(calibrationJob.status, ["DRAFT", "IN_PROGRESS", "REVIEW"]),
        );
      }

      const whereCondition = and(...conditions);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(calibrationJob)
        .where(whereCondition);

      // Get paginated data with joins
      const jobs = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          certificateName: calibrationJob.certificateName,
          status: calibrationJob.status,
          dueDate: calibrationJob.dueDate,
          performedAt: calibrationJob.performedAt,
          createdAt: calibrationJob.createdAt,
          updatedAt: calibrationJob.updatedAt,
          approvedAt: calibrationJob.approvedAt,
          // Related entities
          customerId: calibrationJob.customerId,
          customerName: customer.name,
          assetId: calibrationJob.assetId,
          assetName: asset.name,
          assetTag: asset.tag,
          serviceId: calibrationJob.serviceId,
          serviceName: service.name,
          technicianId: calibrationJob.technicianId,
          technicianName: user.name,
          // Method snapshot summary
          methodSnapshot: calibrationJob.methodSnapshot,
        })
        .from(calibrationJob)
        .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
        .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
        .leftJoin(service, eq(calibrationJob.serviceId, service.id))
        .leftJoin(user, eq(calibrationJob.technicianId, user.id))
        .where(whereCondition)
        .orderBy(desc(calibrationJob.createdAt))
        .limit(limit)
        .offset(offset);

      // Add computed fields
      const now = new Date();
      const financialContexts = await loadJobFinancialContexts(
        memberData.organizationId,
        jobs.map((job) => job.id),
      );
      const jobsWithComputedFields = jobs.map((job) => ({
        ...job,
        isOverdue: job.dueDate
          ? isCalendarDatePast(job.dueDate, now) &&
            ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status)
          : null,
        daysUntilDue: job.dueDate ? labDaysUntil(job.dueDate, now) : null,
        // Extract method name from snapshot for display
        methodName: methodSnapshotDisplay(job.methodSnapshot).methodName,
        methodVersion: methodSnapshotDisplay(job.methodSnapshot).methodVersion,
        ...financialContexts.get(job.id),
      }));

      return c.json({
        data: jobsWithComputedFields,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      } satisfies ServerShape<JobsListResponse>);
    },
  )

  // =========================================================================
  // GET /:id/label - Get job label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({
          id: calibrationJob.id,
          label: calibrationJob.jobId,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const financialContextMap = await loadJobFinancialContexts(
        memberData.organizationId,
        [job.id],
      );

      return c.json({
        ...job,
        ...financialContextMap.get(job.id),
      });
    },
  )

  // =========================================================================
  // GET /:id - Get single job with full details
  // =========================================================================
  .get("/:id", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const id = await resolveJobRouteId(c.req.param("id"), memberData);

    if (id === null) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        certificateName: calibrationJob.certificateName,
        certificateNumberingSnapshot:
          calibrationJob.certificateNumberingSnapshot,
        organizationId: calibrationJob.organizationId,
        unitId: calibrationJob.unitId,
        status: calibrationJob.status,
        dueDate: calibrationJob.dueDate,
        performedAt: calibrationJob.performedAt,
        asFoundConformity: calibrationJob.asFoundConformity,
        asFoundMargins: calibrationJob.asFoundMargins,
        data: calibrationJob.data,
        results: calibrationJob.results,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        environmentalSnapshot: calibrationJob.environmentalSnapshot,
        calibrationLocationSnapshot: calibrationJob.calibrationLocationSnapshot,
        calibrationPhaseSnapshot: calibrationJob.calibrationPhaseSnapshot,
        scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
        scopeComplianceFindings: calibrationJob.scopeComplianceFindings,
        scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
        // §7.8.2.1(n) — the worksheet prefills from this, so it must be in the
        // detail projection or a saved deviation looks like it never persisted.
        methodDeviations: calibrationJob.methodDeviations,
        assetSnapshot: calibrationJob.assetSnapshot,
        certificateUrl: calibrationJob.certificateUrl,
        labelUrl: calibrationJob.labelUrl,
        methodSnapshot: calibrationJob.methodSnapshot,
        createdAt: calibrationJob.createdAt,
        createdBy: calibrationJob.createdBy,
        updatedAt: calibrationJob.updatedAt,
        approvedBy: calibrationJob.approvedBy,
        approvedAt: calibrationJob.approvedAt,
        rejectedBy: calibrationJob.rejectedBy,
        rejectedAt: calibrationJob.rejectedAt,
        rejectionReason: calibrationJob.rejectionReason,
        // Amendment fields - ISO 17025 Clause 7.8.4.1
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        supersededAt: calibrationJob.supersededAt,
        // Related entities
        customerId: calibrationJob.customerId,
        customerName: customer.name,
        customerTaxId: customer.taxId,
        customerAddress: customer.address,
        labName: organization.name,
        labStreet: organization.street,
        labNumber: organization.number,
        labComplement: organization.complement,
        labNeighbourhood: organization.neighbourhood,
        labCity: organization.city,
        labState: organization.state,
        labCep: organization.cep,
        assetId: calibrationJob.assetId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetTypeId: asset.assetTypeId,
        assetSerialNumber: asset.serialNumber,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
        assetBaseMeasurementUnit: asset.baseMeasurementUnit,
        assetSpecifications: asset.specifications,
        assetTypeName: assetType.name,
        assetTypeSlug: assetType.slug,
        assetTypeDefinition: assetType.definition,
        serviceId: calibrationJob.serviceId,
        serviceName: service.name,
        servicePrice: service.price,
        serviceTat: service.tat,
        technicianId: calibrationJob.technicianId,
        technicianName: user.name,
        approverName: approverUser.name,
        rejectorName: rejectorUser.name,
      })
      .from(calibrationJob)
      .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
      .leftJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
      .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
      .leftJoin(service, eq(calibrationJob.serviceId, service.id))
      .leftJoin(user, eq(calibrationJob.technicianId, user.id))
      .leftJoin(approverUser, eq(calibrationJob.approvedBy, approverUser.id))
      .leftJoin(rejectorUser, eq(calibrationJob.rejectedBy, rejectorUser.id))
      .where(
        and(
          eq(calibrationJob.id, id),
          eq(calibrationJob.organizationId, memberData.organizationId),
          buildUnitScopeCondition(calibrationJob.unitId, memberData),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    const financialContextMap = await loadJobFinancialContexts(
      memberData.organizationId,
      [job.id],
    );
    const derivedAssetSnapshot =
      job.assetSnapshot ??
      (["DRAFT", "IN_PROGRESS", "REVIEW", "REJECTED"].includes(job.status)
        ? ({
            assetId: job.assetId,
            assetTypeId: job.assetTypeId ?? 0,
            assetTypeName: job.assetTypeName ?? "",
            assetTypeSlug: job.assetTypeSlug ?? "",
            baseMeasurementUnit: job.assetBaseMeasurementUnit ?? null,
            name: job.assetName ?? "",
            tag: job.assetTag ?? "",
            serialNumber: job.assetSerialNumber ?? "",
            manufacturer: job.assetManufacturer,
            model: job.assetModel,
            specifications: job.assetSpecifications,
            capturedAt: new Date().toISOString(),
          } satisfies AssetSnapshot)
        : null);

    // Add computed fields
    const now = new Date();
    const result = {
      ...job,
      assetSnapshot: derivedAssetSnapshot,
      isOverdue: job.dueDate
        ? isCalendarDatePast(job.dueDate, now) &&
          ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status)
        : null,
      daysUntilDue: job.dueDate ? labDaysUntil(job.dueDate, now) : null,
      ...financialContextMap.get(job.id),
    };

    return c.json(result satisfies ServerShape<JobDetail>);
  })

  // =========================================================================
  // POST / - Create new job (THE CRITICAL SNAPSHOT LOGIC)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ calibration: ["create"] }),
    zValidator("json", CreateJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const activeUnitId = memberData.activeUnitId;
      if (!activeUnitId) {
        return c.json(
          { error: "Selecione uma unidade específica para criar ordens" },
          400,
        );
      }

      try {
        const newJob = await db.transaction(async (tx) => {
          return createCalibrationJob({
            organizationId: memberData.organizationId,
            unitId: activeUnitId,
            createdBy: session.user.id,
            assetId: input.assetId,
            serviceId: input.serviceId,
            technicianId: input.technicianId,
            dueDate: input.dueDate,
            // DOM-02 (#655): back-link to the repair OS this calibration came
            // from, when opened from the pending-after-repair flow. Org-scoped
            // in createCalibrationJob.
            sourceServiceOrderId: input.sourceServiceOrderId ?? null,
            ipAddress: c.req.header("x-forwarded-for") || null,
            executor: tx,
            // Defer the assignment notification until after commit (below) —
            // sending it from inside an open transaction that might still
            // roll back would notify a technician about a job that never
            // existed.
            notifyOnAssignment: false,
          });
        });

        if (newJob.technicianId) {
          try {
            await notifyJobAssigned(
              newJob.id,
              newJob.technicianId,
              session.user.id,
            );
          } catch (error) {
            console.error("Error sending job assignment notification:", error);
          }
        }

        return c.json(newJob satisfies ServerShape<JobCreateResponse>, 201);
      } catch (error) {
        console.error("Error creating job:", error);
        const message =
          error instanceof Error ? error.message : "Erro ao criar job";

        if (
          message === "Ativo nao encontrado" ||
          message === "Servico nao encontrado"
        ) {
          return c.json({ error: message }, 404);
        }

        if (jobCreationClientErrors.has(message)) {
          return c.json({ error: message }, 400);
        }

        return c.json({ error: "Erro ao criar job" }, 500);
      }
    },
  )

  // =========================================================================
  // PUT /:id - Update job (technician, due date)
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ calibration: ["update"] }),
    zValidator("json", UpdateJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await editJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
        technicianId: input.technicianId,
        dueDate: input.dueDate,
      });
      switch (result.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "illegal_transition":
        case "technician_not_found":
        case "competence_missing":
          return domainErrorResponse(c, result.error);
        case "concurrent_update":
          return domainErrorResponse(c, await jobStatusConflict(id));
        case "ok":
          // Notify the technician if it changed.
          if (result.changed.technician && input.technicianId) {
            try {
              await notifyJobAssigned(id, input.technicianId, session.user.id);
            } catch (err) {
              console.error(
                "[Jobs] Failed to send assignment notification:",
                err,
              );
            }
          }
          return c.json(result.job);
      }
    },
  )

  // =========================================================================
  // POST /:id/assign - Assign technician to job
  // =========================================================================
  .post(
    "/:id/assign",
    ...withLabPermission({ calibration: ["assign_technician"] }),
    zValidator("json", AssignTechnicianSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await assignJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
        technicianId: input.technicianId,
      });
      switch (result.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "illegal_transition":
        case "technician_not_found":
        case "competence_missing":
          return domainErrorResponse(c, result.error);
        case "concurrent_update":
          return domainErrorResponse(c, await jobStatusConflict(id));
        case "ok":
          // Send notification to assigned technician
          try {
            await notifyJobAssigned(id, input.technicianId, session.user.id);
          } catch (err) {
            console.error(
              "[Jobs] Failed to send assignment notification:",
              err,
            );
          }

          return c.json({
            message: `Job atribuido a ${result.technicianName}`,
            data: result.job,
          } satisfies ServerShape<JobMutationResponse>);
      }
    },
  )

  // =========================================================================
  // POST /:id/submit - Submit job for review (transition from DRAFT/IN_PROGRESS to REVIEW)
  // Transport only: the policy is `submitJob` (modules/jobs/submit-job.ts).
  // =========================================================================
  .post(
    "/:id/submit",
    ...withLabPermission({ calibration: ["submit"] }),
    zValidator("json", SubmitForReviewSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return domainErrorResponse(c, jobNotFound());
      }

      const result = await submitJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
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
        return jobExecutionRefusalResponse(c, id, result);
      }

      // Send notifications to admins/owners (fire and forget)
      notifyJobSubmittedForReview(id, session.user.id).catch((err) => {
        console.error("[Jobs] Failed to send submit notification:", err);
      });

      return c.json({
        message: "Job submetido para revisao",
        data: result.job,
      } satisfies ServerShape<JobMutationResponse>);
    },
  )

  // =========================================================================
  // POST /:id/execute - Save execution data (worksheet auto-save / manual save)
  // Transport only: the policy is `executeJob` (modules/jobs/submit-job.ts).
  // =========================================================================
  .post(
    "/:id/execute",
    ...withLabPermission({ calibration: ["execute"] }),
    zValidator("json", ExecuteJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return domainErrorResponse(c, jobNotFound());
      }

      const result = await executeJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
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
        return jobExecutionRefusalResponse(c, id, result);
      }

      return c.json({
        message: "Dados salvos com sucesso",
        data: result.job,
        // Standards of the saved snapshot that went stale: the save is kept,
        // the submit will refuse until they are replaced.
        warnings: result.warnings,
      } satisfies ServerShape<JobMutationResponse>);
    },
  )

  // =========================================================================
  // POST /:id/approve - Approve job (manager only)
  // Enqueues certificate generation instead of directly approving
  // =========================================================================
  .post(
    "/:id/approve",
    ...withLabPermission({ calibration: ["approve"] }),
    zValidator("json", ApproveJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await approveJob({
        jobId: id,
        actor: { kind: "user", member: memberData },
        values: input,
        metadata: { ipAddress: c.req.header("x-forwarded-for") || null },
        completion: {
          kind: "generate_certificate_pdf",
          sendServiceOrdersToFinance: (params) =>
            sendServiceOrdersToFinance({
              ...params,
              scope: memberData,
              env: c.env,
            }),
        },
      });

      switch (result.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "invalid_status":
          return domainErrorResponse(
            c,
            invalid(
              "job_not_approvable",
              `Nao e possivel aprovar um job com status ${result.currentStatus}. O job deve estar em REVIEW.`,
            ),
          );
        case "approval_requires_signatory":
          return c.json(
            {
              error:
                "Apenas um signatário autorizado pode aprovar a calibração.",
              code: "approval_requires_signatory",
            },
            403,
          );
        case "role_not_permitted":
          return c.json(
            {
              error: "Seu papel não permite aprovar calibrações.",
              code: "APPROVAL_ROLE_NOT_PERMITTED",
            },
            403,
          );
        case "dispatch_failed":
          return c.json(
            {
              error:
                "Não foi possível enfileirar a geração do certificado. A aprovação foi revertida; tente novamente.",
              code: "APPROVAL_DISPATCH_FAILED",
            },
            503,
          );
        case "concurrent_approval":
          return c.json(
            {
              error:
                "A calibração foi alterada por outra aprovação ou revisão em andamento. Atualize e tente novamente.",
              code: "APPROVAL_CONFLICT",
            },
            409,
          );
        case "self_approval_blocked":
          return c.json(
            {
              error:
                "Separação de responsabilidades (ISO/IEC 17025): quem executou ou criou a calibração não pode aprová-la. Solicite a aprovação a outro membro autorizado.",
              code: "SELF_APPROVAL_BLOCKED",
            },
            403,
          );
        case "not_authorized_signatory":
          return c.json(
            {
              error:
                "O aprovador não é um signatário autorizado para este tipo de instrumento (ISO/IEC 17025 §6.2.6). A liberação do certificado deve ser feita por um signatário autorizado.",
              code: "APPROVER_NOT_AUTHORIZED_SIGNATORY",
            },
            403,
          );
        case "environmental_justification_required":
          return c.json(
            {
              error:
                "Condições ambientais fora dos limites. Forneça uma justificativa para aprovar.",
              environmentalSnapshot: result.environmentalSnapshot,
            },
            400,
          );
        case "scope_violation":
          return c.json(
            {
              error:
                "Violação do escopo acreditado (CMC): a emissão acreditada está bloqueada. Corrija o resultado ou aprove com justificativa documentada. Nesse caso o certificado sai sem o selo de acreditação.",
              code: "SCOPE_VIOLATION",
              scopeCompliance: result.scopeCompliance,
            },
            422,
          );
        case "approved":
          return c.json({
            message: "Gerando certificado...",
            data: result.job,
          } satisfies ServerShape<JobMutationResponse>);
      }
    },
  )

  // =========================================================================
  // POST /:id/reject - Reject job (manager only)
  // =========================================================================
  .post(
    "/:id/reject",
    ...withLabPermission({ calibration: ["reject"] }),
    zValidator("json", RejectJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await rejectJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
        reason: input.reason,
      });
      switch (result.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "illegal_transition":
          return domainErrorResponse(c, result.error);
        case "concurrent_update":
          return domainErrorResponse(c, await jobStatusConflict(id));
        case "ok":
          // Send notification to technician (fire and forget)
          notifyJobRejected(id, session.user.id, input.reason).catch((err) => {
            console.error("[Jobs] Failed to send rejection notification:", err);
          });

          return c.json({
            message: "Job rejeitado",
            data: result.job,
          } satisfies ServerShape<JobMutationResponse>);
      }
    },
  )

  // =========================================================================
  // POST /:id/flag-oot - Flag an approved job as out-of-tolerance (as found):
  // opens a typed NC and generates the §7.10 customer notification (#426).
  // Never gates certificate issuance — it opens a quality workflow only.
  // =========================================================================
  .post(
    "/:id/flag-oot",
    ...withLabPermission({ non_conformance: ["create"] }),
    zValidator("json", FlagJobOutOfToleranceSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Unit scope check here — the shared creator (also used by the desktop
      // sync ingest) only scopes by organization.
      const [scoped] = await db
        .select({
          id: calibrationJob.id,
          asFoundConformity: calibrationJob.asFoundConformity,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!scoped) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await flagJobOutOfTolerance({
        organizationId: memberData.organizationId,
        actorUserId: session.user.id,
        jobId: id,
        description: input.description,
        affectedScope: input.affectedScope,
        notifyCustomer: input.notifyCustomer,
        triggerSource:
          scoped.asFoundConformity === "NON_CONFORMING"
            ? "as_found_verdict"
            : "manual",
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      if (!result.ok) {
        return c.json(
          { error: result.message, code: result.code },
          result.status,
        );
      }

      return c.json(
        {
          message: "Nao conformidade registrada",
          data: { nc: result.nc, notification: result.notification },
        } satisfies ServerShape<JobFlagOotResponse>,
        201,
      );
    },
  )

  // =========================================================================
  // DELETE /:id - Cancel job (soft delete - sets status to CANCELED)
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ calibration: ["delete"] }),
    zValidator("json", CancelJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await cancelJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
        reason: input.reason,
      });
      switch (result.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "illegal_transition":
          return domainErrorResponse(c, result.error);
        case "concurrent_update":
          return domainErrorResponse(c, await jobStatusConflict(id));
        case "ok":
          return c.json({
            message: "Job cancelado",
            data: result.job,
          } satisfies ServerShape<JobMutationResponse>);
      }
    },
  )

  // =========================================================================
  // POST /:id/amend - Create an amended version of an approved certificate
  // ISO 17025:2017 Clause 7.8.4.1 - Amendments to reports and certificates
  // =========================================================================
  .post(
    "/:id/amend",
    ...withLabPermission({ calibration: ["approve"] }), // Only admin/owner can amend
    zValidator("json", AmendJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const outcome = await amendJob({
        actor: {
          kind: "user",
          userId: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        },
        jobId: id,
        organizationId: memberData.organizationId,
        unitScope: memberData,
        reason: input.reason,
      });
      switch (outcome.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "illegal_transition":
        case "already_amended":
          return domainErrorResponse(c, outcome.error);
        case "concurrent_update":
          return domainErrorResponse(c, await jobStatusConflict(id));
        case "ok":
          break;
      }

      const { originalJob, amendedJob, amendmentNumber } = outcome;

      // Reverse traceability (#426 Phase 1): the amendment clones the frozen
      // standards snapshot verbatim, so mirror the links for the new job too.
      await syncJobStandardLinks(
        amendedJob.id,
        originalJob.standardsSnapshot,
        originalJob.performedAt,
        memberData.organizationId,
      );

      await enqueueBackgroundJob({
        jobId: originalJob.id,
        userId: session.user.id,
      });

      // Notify customer (async)
      notifyCertificateAmended(
        originalJob.id,
        amendedJob.id,
        input.reason,
      ).catch((err) => {
        console.error("[Jobs] Failed to send amendment notification:", err);
      });

      return c.json(
        {
          message: "Retificacao criada com sucesso",
          originalJob: {
            id: originalJob.id,
            jobId: originalJob.jobId,
            status: "SUPERSEDED",
          },
          amendedJob: {
            id: amendedJob.id,
            jobId: amendedJob.jobId,
            status: "DRAFT",
            amendmentNumber,
          },
        } satisfies ServerShape<JobAmendResponse>,
        201,
      );
    },
  )

  // =========================================================================
  // GET /:id/amendment-chain - Get the full amendment history for a job
  // ISO 17025:2017 Clause 7.8.4.1 - Traceability of amendments
  // =========================================================================
  .get(
    "/:id/amendment-chain",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const handlerStartedAt = performance.now();
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      try {
        if (id === null) {
          return c.json({ error: "Job nao encontrado" }, 404);
        }

        // Verify job exists and belongs to organization
        const [job] = await db
          .select({ id: calibrationJob.id })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, id),
              eq(calibrationJob.organizationId, memberData.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
            ),
          )
          .limit(1);

        if (!job) {
          return c.json({ error: "Job nao encontrado" }, 404);
        }

        // Safety limit to prevent infinite loops from corrupted data
        const MAX_CHAIN_LENGTH = 100;

        const dbStartedAt = performance.now();
        const chainResult = await db.execute(sql`
        WITH RECURSIVE ancestors AS (
          SELECT
            id,
            supersedes_id,
            0::integer AS depth,
            ARRAY[id]::integer[] AS path
          FROM calibration_job
          WHERE id = ${id}
            AND organization_id = ${memberData.organizationId}

          UNION ALL

          SELECT
            parent.id,
            parent.supersedes_id,
            ancestors.depth + 1,
            ancestors.path || parent.id
          FROM calibration_job parent
          INNER JOIN ancestors ON parent.id = ancestors.supersedes_id
          WHERE parent.organization_id = ${memberData.organizationId}
            AND ancestors.depth < ${MAX_CHAIN_LENGTH}
            AND NOT (parent.id = ANY(ancestors.path))
        ),
        root_job AS (
          SELECT id
          FROM ancestors
          ORDER BY depth DESC
          LIMIT 1
        ),
        chain AS (
          SELECT
            job.id,
            job.job_id,
            job.status,
            job.amendment_number,
            job.amendment_reason,
            job.approved_at,
            job.superseded_at,
            job.superseded_by_id,
            0::integer AS depth,
            ARRAY[job.id]::integer[] AS path
          FROM calibration_job job
          INNER JOIN root_job ON root_job.id = job.id
          WHERE job.organization_id = ${memberData.organizationId}

          UNION ALL

          SELECT
            child.id,
            child.job_id,
            child.status,
            child.amendment_number,
            child.amendment_reason,
            child.approved_at,
            child.superseded_at,
            child.superseded_by_id,
            chain.depth + 1,
            chain.path || child.id
          FROM calibration_job child
          INNER JOIN chain ON child.id = chain.superseded_by_id
          WHERE child.organization_id = ${memberData.organizationId}
            AND chain.depth < ${MAX_CHAIN_LENGTH}
            AND NOT (child.id = ANY(chain.path))
        )
        SELECT
          id,
          job_id,
          status,
          amendment_number,
          amendment_reason,
          approved_at,
          superseded_at,
          depth
        FROM chain
        ORDER BY depth ASC;
      `);
        addServerTiming(c, "amendment_chain_db", dbStartedAt);

        const chainRows = getExecuteRows<{
          id: number;
          job_id: string;
          status: string;
          amendment_number: number | null;
          amendment_reason: string | null;
          approved_at: Date | string | null;
          superseded_at: Date | string | null;
        }>(chainResult);

        const chain = chainRows.map((row) => ({
          id: Number(row.id),
          jobId: row.job_id,
          status: row.status,
          amendmentNumber:
            row.amendment_number === null ? null : Number(row.amendment_number),
          amendmentReason: row.amendment_reason,
          approvedAt: row.approved_at ? new Date(row.approved_at) : null,
          supersededAt: row.superseded_at ? new Date(row.superseded_at) : null,
          isCurrent: Number(row.id) === job.id,
        }));

        return c.json({
          data: chain,
          originalJobId: chain[0]?.id,
          latestJobId: chain[chain.length - 1]?.id,
          totalAmendments: chain.length - 1,
        });
      } finally {
        addServerTiming(c, "amendment_chain_handler", handlerStartedAt);
      }
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for a job
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Verify job exists and belongs to organization
      const [existing] = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get audit logs with performer details
      const logs = await db
        .select({
          id: jobAuditLog.id,
          action: jobAuditLog.action,
          changes: jobAuditLog.changes,
          performedBy: jobAuditLog.performedBy,
          performedAt: jobAuditLog.performedAt,
          ipAddress: jobAuditLog.ipAddress,
          reason: jobAuditLog.reason,
          performerName: user.name,
        })
        .from(jobAuditLog)
        .leftJoin(user, eq(jobAuditLog.performedBy, user.id))
        .where(eq(jobAuditLog.jobId, id))
        .orderBy(desc(jobAuditLog.performedAt));

      return c.json({ data: logs });
    },
  )

  // =========================================================================
  // GET /technicians - Get list of technicians for assignment dropdown
  // =========================================================================
  .get(
    "/technicians/list",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");

      const baseQuery = db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id));

      const technicians = memberData.activeUnitId
        ? await baseQuery
            .leftJoin(
              memberUnitAssignment,
              eq(memberUnitAssignment.memberId, member.id),
            )
            .where(
              and(
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
                or(
                  inArray(member.role, ["admin", "owner"]),
                  and(
                    eq(memberUnitAssignment.unitId, memberData.activeUnitId),
                    inArray(memberUnitAssignment.role, [
                      "technician",
                      "unit_admin",
                    ]),
                  ),
                ),
              ),
            )
            .orderBy(user.name)
        : await baseQuery
            .where(
              and(
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
              ),
            )
            .orderBy(user.name);

      return c.json({
        data: technicians,
      } satisfies ServerShape<JobTechniciansResponse>);
    },
  )

  // =========================================================================
  // GET /:id/download - Generate presigned URL for certificate download
  // =========================================================================
  .get(
    "/:id/download",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ certificateUrl: calibrationJob.certificateUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      if (!job.certificateUrl) {
        return c.json({ error: "Certificado ainda nao foi gerado" }, 400);
      }

      const env = r2EnvFromUnknown(c.env);
      if (shouldUseLocalR2Download(env)) {
        return c.json({
          url: buildLocalJobFileUrl(
            c.req.url,
            c.req.param("id"),
            "certificate",
            env.API_URL,
          ),
        } satisfies JobDownloadUrlResponse);
      }

      const key = extractKeyFromUrl(job.certificateUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url } satisfies JobDownloadUrlResponse);
    },
  )

  // =========================================================================
  // GET /:id/file - Stream certificate from R2 during local dev
  // =========================================================================
  .get(
    "/:id/file",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const env = r2EnvFromUnknown(c.env);
      if (!shouldUseLocalR2Download(env)) {
        return c.json(
          { error: "Disponivel apenas em desenvolvimento local" },
          404,
        );
      }

      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ certificateUrl: calibrationJob.certificateUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job?.certificateUrl) {
        return c.json({ error: "Certificado ainda nao foi gerado" }, 400);
      }

      const key = extractKeyFromUrl(job.certificateUrl);
      const object = await env.CERTIFICATES_BUCKET.get(key);

      if (!object) {
        return c.json({ error: "Arquivo nao encontrado no R2 local" }, 404);
      }

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
          "Content-Disposition": 'inline; filename="certificado.pdf"',
        },
      });
    },
  )

  // =========================================================================
  // POST /:id/generate-label - Enqueue thermal label generation
  // =========================================================================
  .post(
    "/:id/generate-label",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({
          id: calibrationJob.id,
          status: calibrationJob.status,
          labelUrl: calibrationJob.labelUrl,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Only approved jobs can have labels generated
      if (job.status !== "APPROVED") {
        return c.json(
          { error: "Apenas jobs aprovados podem ter etiquetas geradas" },
          400,
        );
      }

      await enqueueBackgroundJob({
        type: "LABEL",
        jobId: id,
        userId: session.user.id,
      });

      return c.json({
        message: "Gerando etiqueta...",
        jobId: id,
      } satisfies ServerShape<JobGenerateLabelResponse>);
    },
  )

  // =========================================================================
  // GET /:id/download-label - Generate presigned URL for label download
  // =========================================================================
  .get(
    "/:id/download-label",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ labelUrl: calibrationJob.labelUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      if (!job.labelUrl) {
        return c.json({ error: "Etiqueta ainda nao foi gerada" }, 400);
      }

      const env = r2EnvFromUnknown(c.env);
      if (shouldUseLocalR2Download(env)) {
        return c.json({
          url: buildLocalJobFileUrl(
            c.req.url,
            c.req.param("id"),
            "label",
            env.API_URL,
          ),
        } satisfies JobDownloadUrlResponse);
      }

      const key = extractKeyFromUrl(job.labelUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url } satisfies JobDownloadUrlResponse);
    },
  )

  // =========================================================================
  // GET /:id/label-commands - Native printer commands for direct thermal printing
  // =========================================================================
  // Rendered server-side (the verification token isn't exposed in the general
  // job DTO) in the requested language (?lang=zpl|tspl). The browser fetches
  // this, then hands the commands to a transport (desktop local-server, Zebra
  // Browser Print, WebUSB, or Web Serial).
  .get(
    "/:id/label-commands",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({
          jobId: calibrationJob.jobId,
          performedAt: calibrationJob.performedAt,
          verificationToken: calibrationJob.verificationToken,
          labName: organization.name,
          assetTag: asset.tag,
        })
        .from(calibrationJob)
        .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
        .leftJoin(
          organization,
          eq(calibrationJob.organizationId, organization.id),
        )
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const dpi = c.req.query("dpi") === "300" ? 300 : 203;
      const language = c.req.query("lang") === "tspl" ? "tspl" : "zpl";
      const commands = renderLabel(
        {
          certNumber: job.jobId,
          labName: job.labName ?? "Laboratório",
          assetTag: job.assetTag ?? "-",
          calibrationDate: job.performedAt,
          // Same public verification URL the worker encodes into the PDF QR.
          verifyUrl: certificateVerificationUrl(job.verificationToken),
        },
        defaultRenderOptions(language, dpi),
      );

      return c.text(commands);
    },
  )

  // =========================================================================
  // GET /:id/label-file - Stream label from R2 during local dev
  // =========================================================================
  .get(
    "/:id/label-file",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const env = r2EnvFromUnknown(c.env);
      if (!shouldUseLocalR2Download(env)) {
        return c.json(
          { error: "Disponivel apenas em desenvolvimento local" },
          404,
        );
      }

      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ labelUrl: calibrationJob.labelUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job?.labelUrl) {
        return c.json({ error: "Etiqueta ainda nao foi gerada" }, 400);
      }

      const key = extractKeyFromUrl(job.labelUrl);
      const object = await env.CERTIFICATES_BUCKET.get(key);

      if (!object) {
        return c.json({ error: "Arquivo nao encontrado no R2 local" }, 404);
      }

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
          "Content-Disposition": 'inline; filename="etiqueta.pdf"',
        },
      });
    },
  );
