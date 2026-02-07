import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  asset,
  customer,
  service,
  calibrationMethod,
  referenceStandard,
  user,
  member,
  environmentalLimits,
  type MethodSnapshot,
  type StandardSnapshot,
  type EnvironmentalSnapshot,
  type EnvironmentalLimitsSnapshot,
} from "@calibra-facil/db/schema";
import {
  notifyJobSubmittedForReview,
  notifyJobApproved,
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
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { requirePlanLimit } from "../middleware/tier-guard";
import { withInvalidation } from "../middleware/cache";
import { eq, and, ilike, desc, count, lte, gte, inArray, isNull, or } from "drizzle-orm";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
} from "../lib/storage";
import { alias } from "drizzle-orm/pg-core";

// Aliases for multiple user joins
const approverUser = alias(user, "approverUser");
const rejectorUser = alias(user, "rejectorUser");

/**
 * Check if environmental readings are within configured limits.
 */
function checkEnvironmentWithinLimits(
  env: { temperature: number | null; humidity: number | null; pressure: number | null },
  limits: EnvironmentalLimitsSnapshot | null,
): boolean {
  if (!limits) return true; // No limits configured = always within
  if (
    limits.temperature &&
    env.temperature != null &&
    (env.temperature < limits.temperature.min ||
      env.temperature > limits.temperature.max)
  ) {
    return false;
  }
  if (
    limits.humidity &&
    env.humidity != null &&
    (env.humidity < limits.humidity.min ||
      env.humidity > limits.humidity.max)
  ) {
    return false;
  }
  if (
    limits.pressure &&
    env.pressure != null &&
    (env.pressure < limits.pressure.min ||
      env.pressure > limits.pressure.max)
  ) {
    return false;
  }
  return true;
}

/**
 * Generates a unique job ID for the organization.
 * Format: CAL-YYYY-XXXX (per organization per year)
 */
async function generateJobId(
  organizationId: string,
  year: number,
): Promise<string> {
  const prefix = `CAL-${year}-`;

  const sequence = await db.transaction(async (tx) => {
    const [result] = await tx
      .select({ jobId: calibrationJob.jobId })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.organizationId, organizationId),
          ilike(calibrationJob.jobId, `${prefix}%`),
        ),
      )
      .orderBy(desc(calibrationJob.jobId))
      .limit(1)
      .for("update");

    if (!result?.jobId) return 1;
    const match = result.jobId.match(/(\d+)$/);
    return match?.[1] ? parseInt(match[1], 10) + 1 : 1;
  });

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
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
 * - POST /: calibration:create (LAB only - technician, admin, owner)
 * - PUT /:id: calibration:update (LAB only)
 * - DELETE /:id: calibration:delete (LAB only) - sets status to CANCELED
 * - POST /:id/assign: calibration:update (LAB only)
 * - POST /:id/submit: calibration:submit (LAB only)
 * - POST /:id/approve: calibration:approve (admin, owner only)
 * - POST /:id/reject: calibration:reject (admin, owner only)
 */
export const jobsRouter = new Hono<{ Variables: AuthVariables }>()
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
      ];

      if (query) {
        conditions.push(ilike(calibrationJob.jobId, `%${query}%`));
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

      // Filter jobs due within 7 days
      if (dueSoon) {
        const now = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(now.getDate() + 7);
        conditions.push(gte(calibrationJob.dueDate, now));
        conditions.push(lte(calibrationJob.dueDate, sevenDaysFromNow));
      }

      // Filter overdue jobs
      if (overdue) {
        const now = new Date();
        conditions.push(lte(calibrationJob.dueDate, now));
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
      const jobsWithComputedFields = jobs.map((job) => ({
        ...job,
        isOverdue:
          job.dueDate &&
          job.dueDate < now &&
          ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status),
        daysUntilDue: job.dueDate
          ? Math.ceil(
              (job.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            )
          : null,
        // Extract method name from snapshot for display
        methodName: (job.methodSnapshot as MethodSnapshot)?.methodName,
        methodVersion: (job.methodSnapshot as MethodSnapshot)?.methodVersion,
      }));

      return c.json({
        data: jobsWithComputedFields,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /:id - Get single job with full details
  // =========================================================================
  .get("/:id", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        organizationId: calibrationJob.organizationId,
        status: calibrationJob.status,
        dueDate: calibrationJob.dueDate,
        performedAt: calibrationJob.performedAt,
        data: calibrationJob.data,
        results: calibrationJob.results,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        environmentalSnapshot: calibrationJob.environmentalSnapshot,
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
        assetId: calibrationJob.assetId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetTypeId: asset.assetTypeId,
        assetSerialNumber: asset.serialNumber,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
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
      .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
      .leftJoin(service, eq(calibrationJob.serviceId, service.id))
      .leftJoin(user, eq(calibrationJob.technicianId, user.id))
      .leftJoin(approverUser, eq(calibrationJob.approvedBy, approverUser.id))
      .leftJoin(rejectorUser, eq(calibrationJob.rejectedBy, rejectorUser.id))
      .where(
        and(
          eq(calibrationJob.id, id),
          eq(calibrationJob.organizationId, memberData.organizationId),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    // Add computed fields
    const now = new Date();
    const result = {
      ...job,
      isOverdue:
        job.dueDate &&
        job.dueDate < now &&
        ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status),
      daysUntilDue: job.dueDate
        ? Math.ceil(
            (job.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null,
    };

    return c.json(result);
  })

  // =========================================================================
  // POST / - Create new job (THE CRITICAL SNAPSHOT LOGIC)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ calibration: ["create"] }),
    requirePlanLimit("certificates"), // Check plan limit before creating job
    withInvalidation("jobs"),
    zValidator("json", CreateJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      try {
        // 1. Validate Asset exists and belongs to organization (via customer)
        const [assetData] = await db
          .select({
            id: asset.id,
            name: asset.name,
            customerId: asset.customerId,
            assetTypeId: asset.assetTypeId,
            deletedAt: asset.deletedAt,
            labOrganizationId: customer.labOrganizationId, // UPDATED: Check labOrg, not authOrg
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(eq(asset.id, input.assetId))
          .limit(1);

        if (!assetData) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        if (assetData.deletedAt) {
          return c.json({ error: "Ativo foi removido" }, 400);
        }

        // Verify that the customer is managed by THIS lab
        if (assetData.labOrganizationId !== memberData.organizationId) {
          return c.json(
            { error: "Ativo nao pertence a esta organizacao" },
            403,
          );
        }

        // 2. Validate Service exists, is active, and belongs to organization
        const [serviceData] = await db
          .select()
          .from(service)
          .where(
            and(
              eq(service.id, input.serviceId),
              eq(service.organizationId, memberData.organizationId),
            ),
          )
          .limit(1);

        if (!serviceData) {
          return c.json({ error: "Servico nao encontrado" }, 404);
        }

        if (!serviceData.isActive) {
          return c.json({ error: "Servico esta inativo" }, 400);
        }

        // 3. Validate Service has a linked Method that is PUBLISHED
        if (!serviceData.methodId) {
          return c.json({ error: "Servico nao possui metodo vinculado" }, 400);
        }

        const [methodData] = await db
          .select()
          .from(calibrationMethod)
          .where(eq(calibrationMethod.id, serviceData.methodId))
          .limit(1);

        if (!methodData) {
          return c.json({ error: "Metodo do servico nao encontrado" }, 404);
        }

        if (methodData.status !== "PUBLISHED") {
          return c.json(
            {
              error:
                "Metodo do servico nao esta publicado. Publique o metodo antes de criar jobs.",
            },
            400,
          );
        }

        // 4. Validate asset type compatibility
        if (
          serviceData.assetTypeId &&
          serviceData.assetTypeId !== assetData.assetTypeId
        ) {
          return c.json(
            {
              error: "Tipo do ativo nao e compativel com o servico selecionado",
            },
            400,
          );
        }

        // 5. Validate technician if provided
        if (input.technicianId) {
          const [techMember] = await db
            .select()
            .from(member)
            .where(
              and(
                eq(member.userId, input.technicianId),
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
              ),
            )
            .limit(1);

          if (!techMember) {
            return c.json(
              { error: "Tecnico nao encontrado ou sem permissao" },
              400,
            );
          }
        }

        // 6. Generate Job ID (per organization per year)
        const year = new Date().getFullYear();
        const jobId = await generateJobId(memberData.organizationId, year);

        // 7. Create Method Snapshot (THE CRITICAL PART)
        // This freezes the method configuration at job creation time
        const methodSnapshot: MethodSnapshot = {
          methodId: methodData.id,
          methodName: methodData.name,
          methodVersion: methodData.version,
          dataFields: methodData.dataFields,
          formulas: methodData.formulas,
          validations: methodData.validations,
          uncertaintyParams: methodData.uncertaintyParams,
        };

        // 8. Calculate due date based on service TAT if not provided
        let dueDate: Date | null = null;
        if (input.dueDate) {
          dueDate = new Date(input.dueDate);
        } else if (serviceData.tat) {
          dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + serviceData.tat);
        }

        // 9. Insert Job
        const [newJob] = await db
          .insert(calibrationJob)
          .values({
            jobId,
            organizationId: memberData.organizationId,
            customerId: assetData.customerId,
            assetId: input.assetId,
            serviceId: input.serviceId,
            technicianId: input.technicianId || null,
            methodSnapshot,
            status: "DRAFT",
            dueDate,
            createdBy: session.user.id,
          })
          .returning();

        if (!newJob) {
          return c.json({ error: "Falha ao criar job" }, 500);
        }

        // 10. Audit Log
        await db.insert(jobAuditLog).values({
          jobId: newJob.id,
          action: "create",
          changes: {
            initial: {
              assetId: input.assetId,
              serviceId: input.serviceId,
              technicianId: input.technicianId,
              dueDate: dueDate?.toISOString(),
              methodSnapshot: {
                methodId: methodSnapshot.methodId,
                methodName: methodSnapshot.methodName,
                methodVersion: methodSnapshot.methodVersion,
              },
            },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        // 11. Notify technician if assigned during creation
        if (input.technicianId) {
          try {
            await notifyJobAssigned(newJob.id, input.technicianId, session.user.id);
          } catch (err) {
            console.error("[Jobs] Failed to send assignment notification:", err);
          }
        }

        return c.json(newJob, 201);
      } catch (error) {
        console.error("Error creating job:", error);
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
    withInvalidation("jobs"),
    zValidator("json", UpdateJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Cannot update approved or canceled jobs
      if (existing.status === "APPROVED" || existing.status === "CANCELED") {
        return c.json(
          {
            error: `Nao e possivel atualizar um job com status ${existing.status}`,
          },
          400,
        );
      }

      // Build changes object for audit log
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const updateData: Record<string, unknown> = {};

      if (
        input.technicianId !== undefined &&
        input.technicianId !== existing.technicianId
      ) {
        // Validate technician
        if (input.technicianId) {
          const [techMember] = await db
            .select()
            .from(member)
            .where(
              and(
                eq(member.userId, input.technicianId),
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
              ),
            )
            .limit(1);

          if (!techMember) {
            return c.json(
              { error: "Tecnico nao encontrado ou sem permissao" },
              400,
            );
          }
        }

        changes.technicianId = {
          old: existing.technicianId,
          new: input.technicianId,
        };
        updateData.technicianId = input.technicianId;
      }

      if (input.dueDate !== undefined) {
        const newDueDate = input.dueDate ? new Date(input.dueDate) : null;
        const oldDueDate = existing.dueDate;
        if (newDueDate?.getTime() !== oldDueDate?.getTime()) {
          changes.dueDate = {
            old: oldDueDate?.toISOString() || null,
            new: newDueDate?.toISOString() || null,
          };
          updateData.dueDate = newDueDate;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set(updateData)
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "update",
        changes,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Notify technician if changed
      if (changes.technicianId && input.technicianId) {
        try {
          await notifyJobAssigned(id, input.technicianId, session.user.id);
        } catch (err) {
          console.error("[Jobs] Failed to send assignment notification:", err);
        }
      }

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/assign - Assign technician to job
  // =========================================================================
  .post(
    "/:id/assign",
    ...withLabPermission({ calibration: ["update"] }),
    withInvalidation("jobs"),
    zValidator("json", AssignTechnicianSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Validate technician
      const [techMember] = await db
        .select({ userId: member.userId, userName: user.name })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.userId, input.technicianId),
            eq(member.organizationId, memberData.organizationId),
            inArray(member.role, ["technician", "admin", "owner"]),
          ),
        )
        .limit(1);

      if (!techMember) {
        return c.json(
          { error: "Tecnico nao encontrado ou sem permissao" },
          400,
        );
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set({ technicianId: input.technicianId })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "assign",
        changes: {
          technicianId: { old: existing.technicianId, new: input.technicianId },
          technicianName: { old: null, new: techMember.userName },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Send notification to assigned technician
      try {
        await notifyJobAssigned(id, input.technicianId, session.user.id);
      } catch (err) {
        console.error("[Jobs] Failed to send assignment notification:", err);
      }

      return c.json({
        message: `Job atribuido a ${techMember.userName}`,
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/submit - Submit job for review (transition from DRAFT/IN_PROGRESS to REVIEW)
  // =========================================================================
  .post(
    "/:id/submit",
    ...withLabPermission({ calibration: ["submit"] }),
    withInvalidation("jobs"),
    zValidator("json", SubmitForReviewSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only submit from DRAFT, IN_PROGRESS, or REJECTED
      if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
        return c.json(
          {
            error: `Nao e possivel submeter um job com status ${existing.status}`,
          },
          400,
        );
      }

      // Update job with data and set status to REVIEW
      const [updated] = await db
        .update(calibrationJob)
        .set({
          data: input.data,
          status: "REVIEW",
          performedAt: new Date(),
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "submit",
        changes: {
          status: { old: existing.status, new: "REVIEW" },
          data: { old: existing.data, new: input.data },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: existing.environmentalSnapshot &&
          !existing.environmentalSnapshot.withinLimits
          ? "Submetido com condições ambientais fora dos limites"
          : undefined,
      });

      // Send notifications to admins/owners (fire and forget)
      notifyJobSubmittedForReview(id, session.user.id).catch((err) => {
        console.error("[Jobs] Failed to send submit notification:", err);
      });

      return c.json({
        message: "Job submetido para revisao",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/execute - Save execution data (worksheet auto-save / manual save)
  // =========================================================================
  .post(
    "/:id/execute",
    ...withLabPermission({ calibration: ["update"] }),
    withInvalidation("jobs"),
    zValidator("json", ExecuteJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only execute from DRAFT, IN_PROGRESS, or REJECTED
      if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
        return c.json(
          {
            error: `Nao e possivel executar um job com status ${existing.status}`,
          },
          400,
        );
      }

      // Build standards snapshot if standards were selected
      let standardsSnapshot: StandardSnapshot[] | null = null;
      if (input.selectedStandardIds && input.selectedStandardIds.length > 0) {
        const standards = await db
          .select()
          .from(referenceStandard)
          .where(
            and(
              inArray(referenceStandard.id, input.selectedStandardIds),
              eq(referenceStandard.organizationId, memberData.organizationId),
            ),
          );

        // Validate all requested standards were found
        if (standards.length !== input.selectedStandardIds.length) {
          const foundIds = new Set(standards.map((s) => s.id));
          const missingIds = input.selectedStandardIds.filter(
            (id) => !foundIds.has(id),
          );
          return c.json(
            {
              error: `Padroes nao encontrados ou nao pertencem a organizacao: ${missingIds.join(", ")}`,
            },
            400,
          );
        }

        // Validate all standards are ACTIVE
        const inactiveStandards = standards.filter(
          (s) => s.status !== "ACTIVE",
        );
        if (inactiveStandards.length > 0) {
          return c.json(
            {
              error: `Os seguintes padroes nao estao ativos: ${inactiveStandards.map((s) => s.name).join(", ")}`,
            },
            400,
          );
        }

        // Validate all standards have valid certificates (not expired)
        const now = new Date();
        const expiredStandards = standards.filter(
          (s) => s.nextCalibrationDate < now,
        );
        if (expiredStandards.length > 0) {
          return c.json(
            {
              error: `Os seguintes padroes estao com certificado vencido: ${expiredStandards.map((s) => s.name).join(", ")}`,
            },
            400,
          );
        }

        // Create snapshot of standards - freeze values at execution time
        standardsSnapshot = standards.map((s) => ({
          id: s.id,
          name: s.name,
          certificateNumber: s.certificateNumber,
          calibrationDate: s.calibrationDate,
          uncertainty: s.uncertainty,
          uncertaintyUnit: s.uncertaintyUnit,
          coverageFactor: s.coverageFactor,
          distribution: s.distribution,
          drift: s.drift,
          certifiedValues: s.certifiedValues,
        }));
      }

      // Build environmental snapshot if environment data was provided
      let environmentalSnapshot: EnvironmentalSnapshot | null =
        existing.environmentalSnapshot;
      if (input.environment) {
        // Look up the asset's assetTypeId
        const [jobAsset] = await db
          .select({ assetTypeId: asset.assetTypeId })
          .from(asset)
          .where(eq(asset.id, existing.assetId))
          .limit(1);

        // Fetch limits: asset-type-specific first, then org default
        let frozenLimits: EnvironmentalLimitsSnapshot | null = null;
        if (jobAsset) {
          const limits = await db
            .select()
            .from(environmentalLimits)
            .where(
              and(
                eq(
                  environmentalLimits.organizationId,
                  memberData.organizationId,
                ),
                or(
                  eq(environmentalLimits.assetTypeId, jobAsset.assetTypeId),
                  isNull(environmentalLimits.assetTypeId),
                ),
              ),
            )
            .orderBy(desc(environmentalLimits.assetTypeId)); // non-null first

          const effectiveLimits = limits[0] ?? null;
          if (effectiveLimits) {
            frozenLimits = {
              ...(effectiveLimits.temperatureMin != null &&
              effectiveLimits.temperatureMax != null
                ? {
                    temperature: {
                      min: effectiveLimits.temperatureMin,
                      max: effectiveLimits.temperatureMax,
                    },
                  }
                : {}),
              ...(effectiveLimits.humidityMin != null &&
              effectiveLimits.humidityMax != null
                ? {
                    humidity: {
                      min: effectiveLimits.humidityMin,
                      max: effectiveLimits.humidityMax,
                    },
                  }
                : {}),
              ...(effectiveLimits.pressureMin != null &&
              effectiveLimits.pressureMax != null
                ? {
                    pressure: {
                      min: effectiveLimits.pressureMin,
                      max: effectiveLimits.pressureMax,
                    },
                  }
                : {}),
            };
          }
        }

        // Check if within limits
        const withinLimits = checkEnvironmentWithinLimits(
          input.environment,
          frozenLimits,
        );

        environmentalSnapshot = {
          temperature: input.environment.temperature,
          humidity: input.environment.humidity,
          pressure: input.environment.pressure,
          recordedAt: new Date().toISOString(),
          recordedBy: session.user.id,
          limits: frozenLimits,
          withinLimits,
          outOfLimitsJustification: null,
        };
      }

      // Determine new status
      const newStatus =
        existing.status === "DRAFT" ? "IN_PROGRESS" : existing.status;

      // Update job with execution data
      const [updated] = await db
        .update(calibrationJob)
        .set({
          data: input.data,
          results: input.results || null,
          standardsSnapshot: standardsSnapshot || existing.standardsSnapshot,
          environmentalSnapshot:
            environmentalSnapshot || existing.environmentalSnapshot,
          status: newStatus,
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "execute",
        changes: {
          status:
            existing.status !== newStatus
              ? { old: existing.status, new: newStatus }
              : undefined,
          data: { old: existing.data, new: input.data },
          standardsSnapshot: standardsSnapshot
            ? { old: existing.standardsSnapshot, new: standardsSnapshot }
            : undefined,
          environmentalSnapshot: environmentalSnapshot
            ? {
                old: existing.environmentalSnapshot,
                new: environmentalSnapshot,
              }
            : undefined,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({
        message: "Dados salvos com sucesso",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/approve - Approve job (manager only)
  // Enqueues certificate generation instead of directly approving
  // =========================================================================
  .post(
    "/:id/approve",
    ...withLabPermission({ calibration: ["approve"] }),
    withInvalidation("jobs"),
    zValidator("json", ApproveJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only approve from REVIEW status
      if (existing.status !== "REVIEW") {
        return c.json(
          {
            error: `Nao e possivel aprovar um job com status ${existing.status}. O job deve estar em REVIEW.`,
          },
          400,
        );
      }

      // Check environmental conditions - block approval if out of limits without justification
      if (
        existing.environmentalSnapshot &&
        !existing.environmentalSnapshot.withinLimits &&
        !existing.environmentalSnapshot.outOfLimitsJustification &&
        !input.environmentalJustification
      ) {
        return c.json(
          {
            error:
              "Condições ambientais fora dos limites. Forneça uma justificativa para aprovar.",
            environmentalSnapshot: existing.environmentalSnapshot,
          },
          400,
        );
      }

      // Save environmental justification if provided
      if (
        input.environmentalJustification &&
        existing.environmentalSnapshot &&
        !existing.environmentalSnapshot.withinLimits
      ) {
        await db
          .update(calibrationJob)
          .set({
            environmentalSnapshot: {
              ...existing.environmentalSnapshot,
              outOfLimitsJustification: input.environmentalJustification,
            },
          })
          .where(eq(calibrationJob.id, id));
      }

      // Update job status to GENERATING_PDF and set approver info
      // (we set approved_by now so the PDF worker can fetch it)
      const [updated] = await db
        .update(calibrationJob)
        .set({
          status: "GENERATING_PDF",
          approvedBy: session.user.id,
          approvedAt: new Date(),
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "approve",
        changes: {
          status: { old: existing.status, new: "GENERATING_PDF" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason || "Aprovado - Gerando PDF",
      });

      // Enqueue certificate generation (Cloudflare Queue)
      // The PDF_QUEUE binding is available via c.env in Cloudflare Workers
      type CloudflareQueue = { send: (body: unknown) => Promise<void> };
      const env = c.env as { PDF_QUEUE?: CloudflareQueue };
      if (env.PDF_QUEUE) {
        await env.PDF_QUEUE.send({
          jobId: id,
          userId: session.user.id,
        });
      } else {
        // Fallback for local dev: log a warning
        console.warn(
          `PDF_QUEUE not available. Job ${id} needs manual certificate generation.`,
        );
      }

      // Send notification to technician (fire and forget)
      notifyJobApproved(id, session.user.id).catch((err) => {
        console.error("[Jobs] Failed to send approval notification:", err);
      });

      return c.json({
        message: "Gerando certificado...",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/reject - Reject job (manager only)
  // =========================================================================
  .post(
    "/:id/reject",
    ...withLabPermission({ calibration: ["reject"] }),
    withInvalidation("jobs"),
    zValidator("json", RejectJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only reject from REVIEW status
      if (existing.status !== "REVIEW") {
        return c.json(
          {
            error: `Nao e possivel rejeitar um job com status ${existing.status}. O job deve estar em REVIEW.`,
          },
          400,
        );
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set({
          status: "REJECTED",
          rejectedBy: session.user.id,
          rejectedAt: new Date(),
          rejectionReason: input.reason,
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "reject",
        changes: {
          status: { old: existing.status, new: "REJECTED" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      // Send notification to technician (fire and forget)
      notifyJobRejected(id, session.user.id, input.reason).catch((err) => {
        console.error("[Jobs] Failed to send rejection notification:", err);
      });

      return c.json({
        message: "Job rejeitado",
        data: updated,
      });
    },
  )

  // =========================================================================
  // DELETE /:id - Cancel job (soft delete - sets status to CANCELED)
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ calibration: ["delete"] }),
    withInvalidation("jobs"),
    zValidator("json", CancelJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Cannot cancel approved jobs (ISO 17025 immutability requirement)
      if (existing.status === "APPROVED") {
        return c.json(
          {
            error:
              "Nao e possivel cancelar um job aprovado. Jobs aprovados sao imutaveis para conformidade ISO 17025.",
          },
          400,
        );
      }

      // Cannot cancel already canceled jobs
      if (existing.status === "CANCELED") {
        return c.json({ error: "Job ja foi cancelado" }, 400);
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set({ status: "CANCELED" })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "cancel",
        changes: {
          status: { old: existing.status, new: "CANCELED" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      return c.json({
        message: "Job cancelado",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/amend - Create an amended version of an approved certificate
  // ISO 17025:2017 Clause 7.8.4.1 - Amendments to reports and certificates
  // =========================================================================
  .post(
    "/:id/amend",
    ...withLabPermission({ calibration: ["approve"] }), // Only admin/owner can amend
    withInvalidation("jobs"),
    zValidator("json", AmendJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing job
      const [originalJob] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!originalJob) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only amend APPROVED jobs
      if (originalJob.status !== "APPROVED") {
        return c.json(
          {
            error: `Apenas certificados aprovados podem ser retificados. Status atual: ${originalJob.status}`,
          },
          400,
        );
      }

      // Check if already superseded
      if (originalJob.supersededById) {
        return c.json(
          {
            error: "Este certificado ja foi retificado",
            supersededBy: originalJob.supersededById,
          },
          400,
        );
      }

      // Calculate amendment number
      let amendmentNumber = 1;
      if (originalJob.supersedesId) {
        // This is already an amendment, increment
        amendmentNumber = (originalJob.amendmentNumber || 0) + 1;
      }

      // Generate new Job ID for the amended job
      const year = new Date().getFullYear();
      const newJobId = await generateJobId(memberData.organizationId, year);

      // Create new job as a clone of the original
      const [amendedJob] = await db
        .insert(calibrationJob)
        .values({
          jobId: newJobId,
          organizationId: originalJob.organizationId,
          customerId: originalJob.customerId,
          assetId: originalJob.assetId,
          serviceId: originalJob.serviceId,
          technicianId: originalJob.technicianId,
          methodSnapshot: originalJob.methodSnapshot,
          standardsSnapshot: originalJob.standardsSnapshot,
          status: "DRAFT", // Start in DRAFT for corrections
          dueDate: originalJob.dueDate,
          data: originalJob.data, // Clone calibration data
          results: originalJob.results, // Clone results
          supersedesId: originalJob.id, // Link to original
          amendmentNumber,
          amendmentReason: input.reason,
          createdBy: session.user.id,
        })
        .returning();

      if (!amendedJob) {
        return c.json({ error: "Falha ao criar retificacao" }, 500);
      }

      // Update original job to SUPERSEDED
      // Store the reason on the original job so it's visible when viewing the superseded certificate
      await db
        .update(calibrationJob)
        .set({
          status: "SUPERSEDED",
          supersededById: amendedJob.id,
          supersededAt: new Date(),
          amendmentReason: input.reason, // Store reason on original job too
        })
        .where(eq(calibrationJob.id, originalJob.id));

      // Queue original job for PDF regeneration with CANCELADO watermark
      type CloudflareQueue = { send: (body: unknown) => Promise<void> };
      const env = c.env as { PDF_QUEUE?: CloudflareQueue };
      if (env.PDF_QUEUE) {
        await env.PDF_QUEUE.send({
          jobId: originalJob.id,
          userId: session.user.id,
        });
      } else {
        console.warn(
          `[Jobs] PDF_QUEUE not available. Superseded job ${originalJob.id} needs manual PDF regeneration.`,
        );
      }

      // Audit log for original job (superseded)
      await db.insert(jobAuditLog).values({
        jobId: originalJob.id,
        action: "supersede",
        changes: {
          status: { old: "APPROVED", new: "SUPERSEDED" },
          supersededById: amendedJob.id,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: `Certificado retificado. Novo: ${amendedJob.jobId}. Motivo: ${input.reason}`,
      });

      // Audit log for amended job (created)
      await db.insert(jobAuditLog).values({
        jobId: amendedJob.id,
        action: "create_amendment",
        changes: {
          supersedesId: originalJob.id,
          amendmentNumber,
          reason: input.reason,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      // Notify customer (async)
      notifyCertificateAmended(originalJob.id, amendedJob.id, input.reason).catch(
        (err) => {
          console.error("[Jobs] Failed to send amendment notification:", err);
        },
      );

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
        },
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
      const memberData = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get the job
      const [job] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Build amendment chain by walking backwards to the original
      const chain: Array<{
        id: number;
        jobId: string;
        status: string;
        amendmentNumber: number | null;
        amendmentReason: string | null;
        approvedAt: Date | null;
        supersededAt: Date | null;
        isCurrent: boolean;
      }> = [];

      // Safety limit to prevent infinite loops from corrupted data
      const MAX_CHAIN_LENGTH = 100;

      // Walk backwards to find the original
      let current = job;
      let iterations = 0;

      while (current.supersedesId && iterations < MAX_CHAIN_LENGTH) {
        iterations++;
        const [parent] = await db
          .select()
          .from(calibrationJob)
          .where(eq(calibrationJob.id, current.supersedesId))
          .limit(1);

        if (parent) {
          current = parent;
        } else {
          break;
        }
      }

      // Now walk forward from the original, building the chain
      // Use Set to detect cycles (corrupted data where A->B->A)
      const chainIds = new Set<number>();
      while (current && chainIds.size < MAX_CHAIN_LENGTH) {
        if (chainIds.has(current.id)) break; // Cycle detected
        chainIds.add(current.id);
        chain.push({
          id: current.id,
          jobId: current.jobId,
          status: current.status,
          amendmentNumber: current.amendmentNumber,
          amendmentReason: current.amendmentReason,
          approvedAt: current.approvedAt,
          supersededAt: current.supersededAt,
          isCurrent: current.id === job.id,
        });

        if (current.supersededById) {
          const [next] = await db
            .select()
            .from(calibrationJob)
            .where(eq(calibrationJob.id, current.supersededById))
            .limit(1);

          if (next) {
            current = next;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      return c.json({
        data: chain,
        originalJobId: chain[0]?.id,
        latestJobId: chain[chain.length - 1]?.id,
        totalAmendments: chain.length - 1,
      });
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
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Verify job exists and belongs to organization
      const [existing] = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
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

      // Get all members with technical roles
      const technicians = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, memberData.organizationId),
            inArray(member.role, ["technician", "admin", "owner"]),
          ),
        )
        .orderBy(user.name);

      return c.json({ data: technicians });
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
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [job] = await db
        .select({ certificateUrl: calibrationJob.certificateUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      if (!job.certificateUrl) {
        return c.json({ error: "Certificado ainda nao foi gerado" }, 400);
      }

      const env = c.env as R2Env;
      const key = extractKeyFromUrl(job.certificateUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url });
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
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
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

      // Enqueue label generation
      type CloudflareQueue = { send: (body: unknown) => Promise<void> };
      const env = c.env as { PDF_QUEUE?: CloudflareQueue };

      if (env.PDF_QUEUE) {
        await env.PDF_QUEUE.send({
          type: "LABEL",
          jobId: id,
          userId: session.user.id,
        });
      } else {
        console.warn(`PDF_QUEUE not available for label generation`);
        return c.json({ error: "Servico de geracao indisponivel" }, 503);
      }

      return c.json({
        message: "Gerando etiqueta...",
        jobId: id,
      });
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
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [job] = await db
        .select({ labelUrl: calibrationJob.labelUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      if (!job.labelUrl) {
        return c.json({ error: "Etiqueta ainda nao foi gerada" }, 400);
      }

      const env = c.env as R2Env;
      const key = extractKeyFromUrl(job.labelUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url });
    },
  );
