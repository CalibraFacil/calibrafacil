import { createRouter } from "../../../server/router";
import { jobEndpoints } from "@calibra-facil/contracts";
import { isOneOf } from "@calibra-facil/shared/status-vocabulary";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { toApiErrorJson } from "../../../lib/api-error-json";
import { DomainError, invalid } from "../../../lib/domain-errors";
import {
  renderLabel,
  defaultRenderOptions,
} from "@calibra-facil/label-rendering";
import { enqueueBackgroundJob } from "../../../lib/background-jobs";
import {
  jobNotFound,
  requireJobRouteId,
  resolveJobRouteId,
} from "../job-access";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import {
  sendServiceOrdersToFinance,
  loadJobFinancialContexts,
} from "../../finance";
import type { IntegrationsEnv } from "../../finance";
import {
  calibrationJob,
  jobAuditLog,
  asset,
  assetType,
  certificateInput,
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
} from "@calibra-facil/notifications";
import {
  OPEN_JOB_STATUSES,
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
  WithdrawCertificateSchema,
  FlagJobOutOfToleranceSchema,
} from "@calibra-facil/schemas";
import type {
  JobAmendResponse,
  JobWithdrawCertificateResponse,
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
import { flagJobOutOfTolerance } from "../oot/oot-notifications";
import { syncJobStandardLinks } from "../job-standards";
import {
  addServerTiming,
  requireRole,
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
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
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
} from "../../../lib/storage";
import { createCalibrationJob } from "../jobs";
import {
  frozenSealColumn,
  frozenSealJoin,
  frozenSealOf,
} from "../certificates/frozen-seal";
import { alias } from "drizzle-orm/pg-core";
import { getExecuteRows } from "../../../lib/db";
import { buildUnitScopeCondition } from "../../../lib/units";
import { r2EnvFromUnknown, methodSnapshotDisplay } from "../commands/helpers";
import { approveJob } from "../commands/approve-job";
import { approvalRefusalError } from "../commands/approval-refusals";
import { amendJob } from "../commands/amend-job";
import { withdrawCertificateIn } from "../commands/withdraw-certificate";
import { loadCertificateLifecycles } from "../certificates/certificate-lifecycle";
import { assignJobIn } from "../commands/assign-job";
import { cancelJob } from "../commands/cancel-job";
import { editJobIn } from "../commands/edit-job";
import { requireJobCommandOk } from "../commands/job-command-result";
import { userJobActor } from "../commands/job-actor";
import { rejectJobIn } from "../commands/reject-job";
import { retryRenderIn } from "../commands/retry-render";
import {
  executeJob,
  submitJob,
  type JobExecutionResult,
} from "../commands/submit-job";
import { jobStatusConflict } from "../commands/job-status-transitions";
import { certificateVerificationUrl } from "@calibra-facil/shared/public-urls";
import { clientIp } from "../../../lib/client-ip";

import {
  laboratoryIsAccredited,
  selfApprovalBlocked,
} from "../commands/approval-gates";
import { allowedJobActions } from "../commands/allowed-actions";
import { requireFreshSession } from "../../../middleware/fresh-session";
// Aliases for multiple user joins
const approverUser = alias(user, "approverUser");
const rejectorUser = alias(user, "rejectorUser");

const CommandPaletteJobSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

/**
 * The 409 body of a lost compare-and-set: the status the job holds now, read in
 * a short transaction that names the laboratory.
 */
function statusConflictFor(jobId: number, organizationId: string) {
  return orgDb(organizationId).transaction((o) => jobStatusConflict(jobId, o));
}

/**
 * The refusal of a submit/execute command that did not write, as the
 * `DomainError` the route throws: the command's own refusal (code, status,
 * pt-BR message), unchanged. Transport mapping only.
 */
async function jobExecutionRefusal(
  jobId: number,
  organizationId: string,
  result: Exclude<JobExecutionResult, { status: "ok" }>,
): Promise<DomainError> {
  switch (result.status) {
    case "not_found":
      return jobNotFound();
    case "concurrent_update":
      return statusConflictFor(jobId, organizationId);
    case "official_execution_failed":
      // The 422 carries the method diagnostics next to the stable code.
      return new DomainError({
        code: result.error.code,
        status: result.error.status,
        message: result.error.message,
        details: result.error.details,
        legacyBody: {
          ...result.error.legacyBody,
          diagnostics: toApiErrorJson(result.failure.diagnostics),
        },
      });
    case "precondition_failed":
      return invalid("invalid_request", result.reason);
    case "illegal_transition":
    case "status_payload_mismatch":
    case "invalid_performed_at":
    case "standards_refused":
    case "asset_unavailable":
    case "record_incomplete":
    case "competence_missing":
      return result.error;
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
 * - POST /:id/retry-render: calibration:approve (admin, owner only)
 */
const PREFIX = "/api/jobs";

export const jobsRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>();

jobsRouter.get(
  "/search",
  ...withLabPermission({ calibration: ["read"] }),
  zValidator("query", CommandPaletteJobSearchQuerySchema),
  async (c) => {
    const memberData = c.get("member");
    const { query, limit } = c.req.valid("query");

    const results = await orgDb(memberData.organizationId).transaction((o) =>
      o
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
        .limit(limit),
    );

    return c.json(results);
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.list,
  withLabPermission({ calibration: ["read"] }),
  async (c, { query: filters }) => {
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
    } = filters;
    const offset = (page - 1) * limit;

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
      conditions.push(inArray(calibrationJob.status, OPEN_JOB_STATUSES));
    }

    const whereCondition = and(...conditions);

    // The count, the page and the financial contexts read ONE consistent
    // view, in a transaction that names the laboratory (row-level security).
    const { countResult, jobs, financialContexts } = await orgDb(
      memberData.organizationId,
    ).transaction(async (o) => {
      const [countResult] = await o
        .select({ total: count() })
        .from(calibrationJob)
        .where(whereCondition);

      const jobs = await o
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
          customerId: calibrationJob.customerId,
          customerName: customer.name,
          assetId: calibrationJob.assetId,
          assetName: asset.name,
          assetTag: asset.tag,
          serviceId: calibrationJob.serviceId,
          serviceName: service.name,
          technicianId: calibrationJob.technicianId,
          technicianName: user.name,
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

      const financialContexts = await loadJobFinancialContexts(
        memberData.organizationId,
        jobs.map((job) => job.id),
        o,
      );
      return { countResult, jobs, financialContexts };
    });

    const now = new Date();
    const jobsWithComputedFields = jobs.map((job) => ({
      ...job,
      isOverdue: job.dueDate
        ? isCalendarDatePast(job.dueDate, now) &&
          isOneOf(OPEN_JOB_STATUSES, job.status)
        : null,
      daysUntilDue: job.dueDate ? labDaysUntil(job.dueDate, now) : null,
      methodName: methodSnapshotDisplay(job.methodSnapshot).methodName,
      methodVersion: methodSnapshotDisplay(job.methodSnapshot).methodVersion,
      ...financialContexts.get(job.id),
    }));

    return {
      data: jobsWithComputedFields,
      pagination: {
        page,
        limit,
        total: countResult?.total ?? 0,
        totalPages: Math.ceil((countResult?.total ?? 0) / limit),
      },
    };
  },
);

jobsRouter.get(
  "/:id/label",
  ...withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");

    const found = await orgDb(memberData.organizationId).transaction(
      async (o) => {
        const id = await resolveJobRouteId(c.req.param("id"), memberData, o);
        if (id === null) return null;

        const [job] = await o
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
        if (!job) return null;

        const financialContextMap = await loadJobFinancialContexts(
          memberData.organizationId,
          [job.id],
          o,
        );
        return { job, financialContext: financialContextMap.get(job.id) };
      },
    );

    if (!found) {
      throw jobNotFound();
    }

    return c.json({
      ...found.job,
      ...found.financialContext,
    });
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.get,
  withLabPermission({ calibration: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");

    const loaded = await orgDb(memberData.organizationId).transaction(
      async (o) => {
        const id = await resolveJobRouteId(params.id, memberData, o);

        if (id === null) {
          return null;
        }

        const [job] = await o
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
            calibrationLocationSnapshot:
              calibrationJob.calibrationLocationSnapshot,
            calibrationPhaseSnapshot: calibrationJob.calibrationPhaseSnapshot,
            scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
            scopeComplianceFindings: calibrationJob.scopeComplianceFindings,
            scopeOverrideJustification:
              calibrationJob.scopeOverrideJustification,
            // §7.8.2.1(n) — the worksheet prefills from this, so it must be in the
            // detail projection or a saved deviation looks like it never persisted.
            methodDeviations: calibrationJob.methodDeviations,
            assetSnapshot: calibrationJob.assetSnapshot,
            certificateUrl: calibrationJob.certificateUrl,
            labelUrl: calibrationJob.labelUrl,
            methodSnapshot: calibrationJob.methodSnapshot,
            createdAt: calibrationJob.createdAt,
            createdBy: calibrationJob.createdBy,
            submittedBy: calibrationJob.submittedBy,
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
            // The seal decision frozen at approval (null before approval
            // and for records approved before migration 0120).
            frozenSeal: frozenSealColumn,
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
          .leftJoin(
            approverUser,
            eq(calibrationJob.approvedBy, approverUser.id),
          )
          .leftJoin(
            rejectorUser,
            eq(calibrationJob.rejectedBy, rejectorUser.id),
          )
          .leftJoin(certificateInput, frozenSealJoin)
          .where(
            and(
              eq(calibrationJob.id, id),
              eq(calibrationJob.organizationId, memberData.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
            ),
          )
          .limit(1);

        if (!job) {
          return null;
        }

        const financialContextMap = await loadJobFinancialContexts(
          memberData.organizationId,
          [job.id],
          o,
        );
        // The lifecycle of the issued certificate (ISSUED / SUPERSEDED /
        // WITHDRAWN, from its status events) and the open amendment, if any:
        // an original with an amendment in progress is still the valid one.
        const certificateLifecycle =
          (await loadCertificateLifecycles(o, [job])).get(job.id) ?? null;
        const [amendmentInProgress] =
          job.status === "APPROVED"
            ? await o
                .select({
                  id: calibrationJob.id,
                  jobId: calibrationJob.jobId,
                  status: calibrationJob.status,
                })
                .from(calibrationJob)
                .where(
                  and(
                    eq(calibrationJob.supersedesId, job.id),
                    ne(calibrationJob.status, "CANCELED"),
                  ),
                )
                .limit(1)
            : [];
        // Separation of duties, for the allowed actions: would this
        // member's approval be refused as approving their own work?
        const approvalBlockedForMember =
          job.status === "REVIEW"
            ? await selfApprovalBlocked(
                {
                  job,
                  organizationId: memberData.organizationId,
                  approverId: memberData.userId,
                  accredited: await laboratoryIsAccredited(
                    memberData.organizationId,
                    o,
                  ),
                },
                o,
              )
            : false;
        return {
          job,
          financialContextMap,
          certificateLifecycle,
          amendmentInProgress: amendmentInProgress ?? null,
          approvalBlockedForMember,
        };
      },
    );
    if (!loaded) {
      throw jobNotFound();
    }
    const {
      job: loadedJob,
      financialContextMap,
      certificateLifecycle,
      amendmentInProgress,
      approvalBlockedForMember,
    } = loaded;
    const { frozenSeal, submittedBy: _submittedBy, ...job } = loadedJob;
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

    const now = new Date();
    const result = {
      ...job,
      assetSnapshot: derivedAssetSnapshot,
      accreditationSeal: frozenSealOf(frozenSeal),
      certificateLifecycle: certificateLifecycle
        ? {
            status: certificateLifecycle.status,
            changedAt: certificateLifecycle.latest
              ? new Date(certificateLifecycle.latest.occurredAt)
              : null,
            reason: certificateLifecycle.latest?.reason ?? null,
          }
        : null,
      amendmentInProgress,
      allowedActions: allowedJobActions({
        status: job.status,
        member: memberData,
        selfApprovalBlocked: approvalBlockedForMember,
        certificateStatus: certificateLifecycle?.status ?? null,
        amendmentInProgress: amendmentInProgress !== null,
      }),
      isOverdue: job.dueDate
        ? isCalendarDatePast(job.dueDate, now) &&
          isOneOf(OPEN_JOB_STATUSES, job.status)
        : null,
      daysUntilDue: job.dueDate ? labDaysUntil(job.dueDate, now) : null,
      ...financialContextMap.get(job.id),
    };

    return result;
  },
);

// =========================================================================
// POST / - Create new job (THE CRITICAL SNAPSHOT LOGIC)
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.create,
  withLabPermission({ calibration: ["create"] }),
  async (c, { body }) => {
    const memberData = c.get("member");
    const input = body;

    const activeUnitId = memberData.activeUnitId;
    if (!activeUnitId) {
      throw invalid(
        "unit_active_required",
        "Selecione uma unidade específica para criar ordens",
      );
    }

    // One transaction that names the laboratory (row-level security); the
    // raw executor goes to the creator, whose advisory lock and certificate
    // numbering run raw SQL.
    const newJob = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const job = await createCalibrationJob({
          organizationId: ctx.org,
          unitId: activeUnitId,
          createdBy: ctx.actor.userId,
          assetId: input.assetId,
          serviceId: input.serviceId,
          technicianId: input.technicianId,
          dueDate: input.dueDate,
          // Back-link to the repair OS this calibration came
          // from, when opened from the pending-after-repair flow. Org-scoped
          // in createCalibrationJob.
          sourceServiceOrderId: input.sourceServiceOrderId ?? null,
          ipAddress: ctx.actor.ipAddress,
          executor: ctx.tx,
        });

        // The assignment notification waits for the commit: sending it from
        // inside an open transaction that might still roll back would notify
        // a technician about a job that never existed.
        const { technicianId } = job;
        if (technicianId) {
          ctx.afterCommit(() =>
            notifyJobAssigned(job.id, technicianId, ctx.actor.userId),
          );
        }
        return job;
      },
    );

    return newJob;
  },
);

jobsRouter.put(
  "/:id",
  ...withLabPermission({ calibration: ["update"] }),
  zValidator("json", UpdateJobSchema),
  async (c) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(c.req.param("id"), memberData);
    const input = c.req.valid("json");

    const job = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const result = await requireJobCommandOk(
          ctx.o,
          id,
          await editJobIn(ctx.o, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
            technicianId: input.technicianId,
            dueDate: input.dueDate,
          }),
        );
        const { technicianId } = input;
        if (result.changed.technician && technicianId) {
          ctx.afterCommit(() =>
            notifyJobAssigned(id, technicianId, ctx.actor.userId),
          );
        }
        return result.job;
      },
    );

    return c.json(job);
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.assign,
  withLabPermission({ calibration: ["assign_technician"] }),
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const assigned = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const result = await requireJobCommandOk(
          ctx.o,
          id,
          await assignJobIn(ctx.o, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
            technicianId: input.technicianId,
          }),
        );
        ctx.afterCommit(() =>
          notifyJobAssigned(id, input.technicianId, ctx.actor.userId),
        );
        return result;
      },
    );

    return {
      message: `Job atribuido a ${assigned.technicianName}`,
      data: assigned.job,
    };
  },
);

// =========================================================================
// POST /:id/submit - Submit job for review (transition from DRAFT/IN_PROGRESS to REVIEW)
// Transport only: the policy is `submitJob` (domains/jobs/commands/submit-job.ts).
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.submitExecution,
  withLabPermission({ calibration: ["submit"] }),
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const result = await submitJob({
      actor: {
        kind: "user",
        userId: session.user.id,
        ipAddress: clientIp(c),
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
      throw await jobExecutionRefusal(id, memberData.organizationId, result);
    }

    notifyJobSubmittedForReview(id, session.user.id).catch((err) => {
      console.error("[Jobs] Failed to send submit notification:", err);
    });

    return {
      message: "Job submetido para revisao",
      data: result.job,
    };
  },
);

// =========================================================================
// POST /:id/execute - Save execution data (worksheet auto-save / manual save)
// Transport only: the policy is `executeJob` (domains/jobs/commands/submit-job.ts).
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.saveExecution,
  withLabPermission({ calibration: ["execute"] }),
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const result = await executeJob({
      actor: {
        kind: "user",
        userId: session.user.id,
        ipAddress: clientIp(c),
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
      throw await jobExecutionRefusal(id, memberData.organizationId, result);
    }

    return {
      message: "Dados salvos com sucesso",
      data: result.job,
      // Standards of the saved snapshot that went stale: the save is kept,
      // the submit will refuse until they are replaced.
      warnings: result.warnings,
    };
  },
);

// =========================================================================
// POST /:id/approve - Approve job (manager only)
// Enqueues certificate generation instead of directly approving. The
// approval runs its own read / write transactions (`approveJob`): the
// certificate images are read from object storage between them and a
// failed dispatch is compensated after the commit, neither of which a
// single `withOrg` transaction can express.
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.approve,
  [...withLabPermission({ calibration: ["approve"] }), requireFreshSession],
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const result = await approveJob({
      jobId: id,
      actor: { kind: "user", member: memberData },
      values: input,
      metadata: { ipAddress: clientIp(c) },
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
    if (result.status !== "approved") throw approvalRefusalError(result);

    return {
      message: "Gerando certificado...",
      data: result.job,
    };
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.reject,
  withLabPermission({ calibration: ["reject"] }),
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const rejected = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const result = await requireJobCommandOk(
          ctx.o,
          id,
          await rejectJobIn(ctx.o, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
            reason: input.reason,
          }),
        );
        ctx.afterCommit(() =>
          notifyJobRejected(id, ctx.actor.userId, input.reason),
        );
        return result.job;
      },
    );

    return {
      message: "Job rejeitado",
      data: rejected,
    };
  },
);

// =========================================================================
// POST /:id/retry-render - Render again the certificate of an approved job
// whose render failed (RENDER_FAILED -> GENERATING_PDF)
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.retryRender,
  withLabPermission({ calibration: ["approve"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);

    const retried = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) =>
        requireJobCommandOk(
          ctx.o,
          id,
          await retryRenderIn(ctx, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
          }),
        ),
    );

    return {
      message: "Emissão do certificado reenviada",
      data: retried.job,
    };
  },
);

// =========================================================================
// POST /:id/flag-oot - Flag an approved job as out-of-tolerance (as found):
// opens a typed NC and generates the §7.10 customer notification.
// Never gates certificate issuance — it opens a quality workflow only.
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.flagOutOfTolerance,
  withLabPermission({ non_conformance: ["create"] }),
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    // The unit-scope check, the NC and the customer notification are written
    // in ONE transaction that names the laboratory (row-level security); the
    // notification PDF job and the NC notification read what it wrote, so
    // they run once it has committed.
    const flagged = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        // Unit scope check here — the shared creator (also used by the
        // desktop sync ingest) only scopes by organization.
        const [scoped] = await ctx.o
          .select({
            id: calibrationJob.id,
            asFoundConformity: calibrationJob.asFoundConformity,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, id),
              eq(calibrationJob.organizationId, ctx.org),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
            ),
          )
          .limit(1);

        if (!scoped) throw jobNotFound();

        const result = await flagJobOutOfTolerance(
          {
            organizationId: ctx.org,
            actorUserId: ctx.actor.userId,
            jobId: id,
            description: input.description,
            affectedScope: input.affectedScope,
            notifyCustomer: input.notifyCustomer,
            triggerSource:
              scoped.asFoundConformity === "NON_CONFORMING"
                ? "as_found_verdict"
                : "manual",
          },
          ctx,
        );
        // A refusal comes back before anything is written.
        if (!result.ok) {
          throw new DomainError({
            code: result.code,
            status: result.status,
            message: result.message,
          });
        }
        return result;
      },
    );

    return {
      message: "Nao conformidade registrada",
      data: { nc: flagged.nc, notification: flagged.notification },
    };
  },
);

// =========================================================================
// DELETE /:id - Cancel job (soft delete - sets status to CANCELED)
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.cancel,
  withLabPermission({ calibration: ["delete"] }),
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const canceled = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) =>
        requireJobCommandOk(
          ctx.o,
          id,
          // The read and the compare-and-set write run on the context's one
          // transaction; the write still matches on the status it read.
          await cancelJob(ctx, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
            reason: input.reason,
          }),
        ),
    );

    return {
      message: "Job cancelado",
      data: canceled.job,
    };
  },
);

// =========================================================================
// POST /:id/amend - Create an amended version of an approved certificate
// ISO 17025:2017 Clause 7.8.4.1 - Amendments to reports and certificates
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.amend,
  [
    ...withLabPermission({ calibration: ["approve"] }),
    zValidator("json", AmendJobSchema),
  ],
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const { originalJob, amendedJob, amendmentNumber } = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const amended = await requireJobCommandOk(
          ctx.o,
          id,
          await amendJob(ctx, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
            reason: input.reason,
          }),
        );

        // Reverse traceability: the amendment clones the
        // frozen standards snapshot verbatim, so mirror the links for the new
        // job too. A derived index of that snapshot, written in the same
        // transaction: a failure rolls the amendment back.
        await syncJobStandardLinks(
          amended.amendedJob.id,
          amended.originalJob.standardsSnapshot,
          amended.originalJob.performedAt,
          ctx.org,
          ctx.o,
        );
        return amended;
      },
    );

    // The original stays APPROVED (the valid certificate) until the
    // replacement is issued: the worker supersedes it in the issuance
    // transaction and tells the customer then. Nothing is enqueued or sent
    // for the original here.

    return {
      message: "Retificacao criada com sucesso",
      originalJob: {
        id: originalJob.id,
        jobId: originalJob.jobId,
        status: "APPROVED" as const,
      },
      amendedJob: {
        id: amendedJob.id,
        jobId: amendedJob.jobId,
        status: "DRAFT" as const,
        amendmentNumber,
      },
    };
  },
);

// =========================================================================
// POST /:id/certificate/withdraw - Withdraw an issued certificate
// ISO 17025:2017 Clause 7.10 - Nonconforming work (e.g. after a recall)
// The job keeps its status; the certificate lifecycle gets a WITHDRAWN event.
// =========================================================================
mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.withdrawCertificate,
  [
    ...withLabPermission({ calibration: ["approve"] }),
    requireRole(["admin", "owner"]),
    zValidator("json", WithdrawCertificateSchema),
  ],
  async (c, { params, body }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);
    const input = body;

    const outcome = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) =>
        requireJobCommandOk(
          ctx.o,
          id,
          await withdrawCertificateIn(ctx.o, {
            actor: userJobActor(ctx.actor),
            jobId: id,
            organizationId: ctx.org,
            unitScope: memberData,
            reason: input.reason,
          }),
        ),
    );

    return {
      message: "Certificado retirado com sucesso",
      job: {
        id: outcome.jobId,
        jobId: outcome.jobNumber,
        status: outcome.jobStatus,
      },
      certificateStatus: "WITHDRAWN" as const,
      withdrawnAt: outcome.withdrawnAt.toISOString(),
    };
  },
);

// =========================================================================
// GET /:id/amendment-chain - Get the full amendment history for a job
// ISO 17025:2017 Clause 7.8.4.1 - Traceability of amendments
// =========================================================================
jobsRouter.get(
  "/:id/amendment-chain",
  ...withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const handlerStartedAt = performance.now();
    const memberData = c.get("member");

    try {
      const id = await requireJobRouteId(c.req.param("id"), memberData);

      // Safety limit to prevent infinite loops from corrupted data
      const MAX_CHAIN_LENGTH = 100;

      const dbStartedAt = performance.now();
      // The job check and the recursive chain read run in one transaction
      // that names the laboratory (row-level security). The chain is raw SQL
      // (a recursive CTE the handle cannot express): it takes the raw
      // executor, and every table in it carries the organization predicate.
      const chain = await withOrg(
        memberData.organizationId,
        requestActor(c),
        async ({ o, tx }) => {
          const [job] = await o
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
            return null;
          }

          const chainResult = await tx.execute(sql`
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
          const chainRows = getExecuteRows<{
            id: number;
            job_id: string;
            status: string;
            amendment_number: number | null;
            amendment_reason: string | null;
            approved_at: Date | string | null;
            superseded_at: Date | string | null;
          }>(chainResult);

          return chainRows.map((row) => ({
            id: Number(row.id),
            jobId: row.job_id,
            status: row.status,
            amendmentNumber:
              row.amendment_number === null
                ? null
                : Number(row.amendment_number),
            amendmentReason: row.amendment_reason,
            approvedAt: row.approved_at ? new Date(row.approved_at) : null,
            supersededAt: row.superseded_at
              ? new Date(row.superseded_at)
              : null,
            isCurrent: Number(row.id) === job.id,
          }));
        },
      );
      addServerTiming(c, "amendment_chain_db", dbStartedAt);
      if (chain === null) {
        throw jobNotFound();
      }

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
);

jobsRouter.get(
  "/:id/audit-log",
  ...withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(c.req.param("id"), memberData);

    const logs = await orgDb(memberData.organizationId).transaction(
      async (o) => {
        const [existing] = await o
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

        if (!existing) return null;

        return o
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
      },
    );

    if (!logs) {
      throw jobNotFound();
    }

    return c.json({ data: logs });
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.listTechnicians,
  withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");

    const technicians = await orgDb(memberData.organizationId).transaction(
      async (o) => {
        const baseQuery = o
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            role: member.role,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id));

        return memberData.activeUnitId
          ? baseQuery
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
          : baseQuery
              .where(
                and(
                  eq(member.organizationId, memberData.organizationId),
                  inArray(member.role, ["technician", "admin", "owner"]),
                ),
              )
              .orderBy(user.name);
      },
    );

    return {
      data: technicians,
    };
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.getCertificateDownloadUrl,
  withLabPermission({ calibration: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);

    const [job] = await orgDb(memberData.organizationId).transaction((o) =>
      o
        .select({ certificateUrl: calibrationJob.certificateUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1),
    );

    if (!job) {
      throw jobNotFound();
    }

    if (!job.certificateUrl) {
      throw invalid(
        "certificate_not_ready",
        "Certificado ainda nao foi gerado",
      );
    }

    const env = r2EnvFromUnknown(c.env);

    const key = extractKeyFromUrl(job.certificateUrl);
    const client = createR2Client(env);
    const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

    return { url };
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.generateLabel,
  withLabPermission({ calibration: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const id = await requireJobRouteId(params.id, memberData);

    const [job] = await orgDb(memberData.organizationId).transaction((o) =>
      o
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
        .limit(1),
    );

    if (!job) {
      throw jobNotFound();
    }

    if (job.status !== "APPROVED") {
      throw invalid(
        "invalid_request",
        "Apenas jobs aprovados podem ter etiquetas geradas",
      );
    }

    await enqueueBackgroundJob({
      type: "LABEL",
      jobId: id,
      userId: session.user.id,
    });

    return {
      message: "Gerando etiqueta...",
      jobId: id,
    };
  },
);

mount(
  jobsRouter,
  PREFIX,
  jobEndpoints.getLabelDownloadUrl,
  withLabPermission({ calibration: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(params.id, memberData);

    const [job] = await orgDb(memberData.organizationId).transaction((o) =>
      o
        .select({ labelUrl: calibrationJob.labelUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1),
    );

    if (!job) {
      throw jobNotFound();
    }

    if (!job.labelUrl) {
      throw invalid("invalid_request", "Etiqueta ainda nao foi gerada");
    }

    const env = r2EnvFromUnknown(c.env);

    const key = extractKeyFromUrl(job.labelUrl);
    const client = createR2Client(env);
    const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

    return { url };
  },
);

// =========================================================================
// GET /:id/label-commands - Native printer commands for direct thermal printing
// =========================================================================
// Rendered server-side (the verification token isn't exposed in the general
// job DTO) in the requested language (?lang=zpl|tspl). The browser fetches
// this, then hands the commands to a transport (desktop local-server, Zebra
// Browser Print, WebUSB, or Web Serial).
jobsRouter.get(
  "/:id/label-commands",
  ...withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const id = await requireJobRouteId(c.req.param("id"), memberData);

    const [job] = await orgDb(memberData.organizationId).transaction((o) =>
      o
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
        .limit(1),
    );

    if (!job) {
      throw jobNotFound();
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
);
