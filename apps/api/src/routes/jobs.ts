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
  type MethodSnapshot,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
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
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, ilike, desc, count, lte, gte, inArray } from "drizzle-orm";
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
        certificateUrl: calibrationJob.certificateUrl,
        methodSnapshot: calibrationJob.methodSnapshot,
        createdAt: calibrationJob.createdAt,
        createdBy: calibrationJob.createdBy,
        updatedAt: calibrationJob.updatedAt,
        approvedBy: calibrationJob.approvedBy,
        approvedAt: calibrationJob.approvedAt,
        rejectedBy: calibrationJob.rejectedBy,
        rejectedAt: calibrationJob.rejectedAt,
        rejectionReason: calibrationJob.rejectionReason,
        // Related entities
        customerId: calibrationJob.customerId,
        customerName: customer.name,
        customerTaxId: customer.taxId,
        assetId: calibrationJob.assetId,
        assetName: asset.name,
        assetTag: asset.tag,
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

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/assign - Assign technician to job
  // =========================================================================
  .post(
    "/:id/assign",
    ...withLabPermission({ calibration: ["update"] }),
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

      // Determine new status
      const newStatus = existing.status === "DRAFT" ? "IN_PROGRESS" : existing.status;

      // Update job with execution data
      const [updated] = await db
        .update(calibrationJob)
        .set({
          data: input.data,
          results: input.results || null,
          standardsSnapshot: standardsSnapshot || existing.standardsSnapshot,
          status: newStatus,
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "execute",
        changes: {
          status: existing.status !== newStatus ? { old: existing.status, new: newStatus } : undefined,
          data: { old: existing.data, new: input.data },
          standardsSnapshot: standardsSnapshot
            ? { old: existing.standardsSnapshot, new: standardsSnapshot }
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
  );
