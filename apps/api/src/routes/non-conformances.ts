import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  nonConformance,
  nonConformanceAuditLog,
  correctiveAction,
  calibrationJob,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateNonConformanceSchema,
  SetDispositionSchema,
  ResolveNonConformanceSchema,
  EscalateToCapaSchema,
  ListNonConformancesQuerySchema,
} from "@calibra-facil/schemas";
import {
  notifyNCCreated,
  notifyNCEscalatedToCapa,
} from "@calibra-facil/notifications";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, or, ilike, desc, count, gte, lte, sql } from "drizzle-orm";

const MAX_SEQ_RETRIES = 3;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("unique") ||
      err.message.includes("duplicate") ||
      err.message.includes("23505"))
  );
}

/**
 * Non-Conformance Router - ISO 17025:2017 Clause 8.7 (Control of Nonconforming Work)
 *
 * Tracks nonconforming work, equipment issues, and documentation errors.
 * Supports disposition workflow and escalation to CAPA.
 *
 * Permissions:
 * - GET /: non_conformance:read (all roles)
 * - GET /:id: non_conformance:read (all roles)
 * - POST /: non_conformance:create (technician, admin, owner)
 * - PUT /:id/disposition: non_conformance:update (technician for rework/scrap, admin/owner for use_as_is/concession)
 * - POST /:id/resolve: non_conformance:update (technician, admin, owner)
 * - POST /:id/escalate-to-capa: non_conformance:escalate (admin, owner)
 * - GET /:id/audit-log: non_conformance:read (all roles)
 */
export const nonConformancesRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List non-conformances with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ non_conformance: ["read"] }),
    zValidator("query", ListNonConformancesQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, status, type, jobId, dateFrom, dateTo } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(nonConformance.organizationId, member.organizationId),
      ];

      if (query) {
        conditions.push(
          or(
            ilike(nonConformance.ncNumber, `%${query}%`),
            ilike(nonConformance.description, `%${query}%`),
          )!,
        );
      }

      if (status) {
        conditions.push(eq(nonConformance.status, status));
      }

      if (type) {
        conditions.push(eq(nonConformance.type, type));
      }

      if (jobId) {
        conditions.push(eq(nonConformance.jobId, jobId));
      }

      if (dateFrom) {
        conditions.push(gte(nonConformance.detectedAt, new Date(dateFrom)));
      }

      if (dateTo) {
        conditions.push(lte(nonConformance.detectedAt, new Date(dateTo)));
      }

      const whereCondition = and(...conditions);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(nonConformance)
        .where(whereCondition);

      // Get paginated data with detector user name
      const ncs = await db
        .select({
          id: nonConformance.id,
          ncNumber: nonConformance.ncNumber,
          jobId: nonConformance.jobId,
          type: nonConformance.type,
          description: nonConformance.description,
          detectedBy: nonConformance.detectedBy,
          detectedAt: nonConformance.detectedAt,
          disposition: nonConformance.disposition,
          dispositionJustification: nonConformance.dispositionJustification,
          dispositionApprovedBy: nonConformance.dispositionApprovedBy,
          dispositionApprovedAt: nonConformance.dispositionApprovedAt,
          correctionTaken: nonConformance.correctionTaken,
          resolvedAt: nonConformance.resolvedAt,
          resolvedBy: nonConformance.resolvedBy,
          status: nonConformance.status,
          capaId: nonConformance.capaId,
          createdAt: nonConformance.createdAt,
          updatedAt: nonConformance.updatedAt,
          detectedByName: user.name,
        })
        .from(nonConformance)
        .leftJoin(user, eq(nonConformance.detectedBy, user.id))
        .where(whereCondition)
        .orderBy(desc(nonConformance.detectedAt))
        .limit(limit)
        .offset(offset);

      // Add computed field: age in days
      const now = new Date();
      const ncsWithAge = ncs.map((nc) => ({
        ...nc,
        ageDays: Math.ceil(
          (now.getTime() - nc.detectedAt.getTime()) / (1000 * 60 * 60 * 24),
        ),
      }));

      return c.json({
        data: ncsWithAge,
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
  // GET /summary - Dashboard summary of open NCs by type and age
  // =========================================================================
  .get(
    "/summary",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const orgId = member.organizationId;

      // Count by status
      const statusCounts = await db
        .select({
          status: nonConformance.status,
          count: count(),
        })
        .from(nonConformance)
        .where(eq(nonConformance.organizationId, orgId))
        .groupBy(nonConformance.status);

      // Count open NCs by type
      const typeCounts = await db
        .select({
          type: nonConformance.type,
          count: count(),
        })
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.organizationId, orgId),
            eq(nonConformance.status, "open"),
          ),
        )
        .groupBy(nonConformance.type);

      // Count by age brackets (open NCs only)
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [recentCount] = await db
        .select({ count: count() })
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.organizationId, orgId),
            eq(nonConformance.status, "open"),
            gte(nonConformance.detectedAt, sevenDaysAgo),
          ),
        );

      const [overdueLongCount] = await db
        .select({ count: count() })
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.organizationId, orgId),
            eq(nonConformance.status, "open"),
            lte(nonConformance.detectedAt, thirtyDaysAgo),
          ),
        );

      return c.json({
        byStatus: statusCounts,
        byType: typeCounts,
        ageBrackets: {
          lessThan7Days: recentCount?.count ?? 0,
          moreThan30Days: overdueLongCount?.count ?? 0,
        },
      });
    },
  )

  // =========================================================================
  // GET /:id/label - Get NC label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [nc] = await db
        .select({
          id: nonConformance.id,
          label: nonConformance.ncNumber,
        })
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!nc) {
        return c.json({ error: "Nao conformidade nao encontrada" }, 404);
      }

      return c.json(nc);
    },
  )

  // =========================================================================
  // GET /:id - Get single NC by ID
  // =========================================================================
  .get(
    "/:id",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [nc] = await db
        .select()
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!nc) {
        return c.json({ error: "Nao conformidade nao encontrada" }, 404);
      }

      // Get related CAPA if exists
      let capa = null;
      if (nc.capaId) {
        const [capaResult] = await db
          .select()
          .from(correctiveAction)
          .where(
            and(
              eq(correctiveAction.id, nc.capaId),
              eq(correctiveAction.organizationId, member.organizationId),
            ),
          )
          .limit(1);
        capa = capaResult ?? null;
      }

      // Get related job info if exists (scoped to org for defense-in-depth)
      let job = null;
      if (nc.jobId) {
        const [jobResult] = await db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            status: calibrationJob.status,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, nc.jobId),
              eq(calibrationJob.organizationId, member.organizationId),
            ),
          )
          .limit(1);
        job = jobResult ?? null;
      }

      // Get user names
      const [detectedByUser] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, nc.detectedBy))
        .limit(1);

      let dispositionApproverName = null;
      if (nc.dispositionApprovedBy) {
        const [approver] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, nc.dispositionApprovedBy))
          .limit(1);
        dispositionApproverName = approver?.name ?? null;
      }

      let resolverName = null;
      if (nc.resolvedBy) {
        const [resolver] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, nc.resolvedBy))
          .limit(1);
        resolverName = resolver?.name ?? null;
      }

      const now = new Date();

      return c.json({
        ...nc,
        detectedByName: detectedByUser?.name ?? null,
        dispositionApproverName,
        resolverName,
        capa,
        job,
        ageDays: Math.ceil(
          (now.getTime() - nc.detectedAt.getTime()) / (1000 * 60 * 60 * 24),
        ),
      });
    },
  )

  // =========================================================================
  // POST / - Create new non-conformance
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ non_conformance: ["create"] }),
    zValidator("json", CreateNonConformanceSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      // If jobId provided, verify it belongs to the organization
      if (input.jobId) {
        const [job] = await db
          .select({ id: calibrationJob.id })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, input.jobId),
              eq(calibrationJob.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!job) {
          return c.json({ error: "Ordem de servico nao encontrada" }, 404);
        }
      }

      // Generate NC number with retry on unique constraint violation
      let newNc: typeof nonConformance.$inferSelect | null = null;
      for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
        const year = new Date().getFullYear();
        const [lastNc] = await db
          .select({ ncNumber: nonConformance.ncNumber })
          .from(nonConformance)
          .where(
            and(
              eq(nonConformance.organizationId, member.organizationId),
              ilike(nonConformance.ncNumber, `NC-${year}-%`),
            ),
          )
          .orderBy(desc(nonConformance.ncNumber))
          .limit(1);

        let nextSeq = 1;
        if (lastNc) {
          const parts = lastNc.ncNumber.split("-");
          nextSeq = parseInt(parts[2] ?? "0", 10) + 1;
        }
        const ncNumber = `NC-${year}-${String(nextSeq).padStart(4, "0")}`;

        try {
          const [inserted] = await db
            .insert(nonConformance)
            .values({
              ncNumber,
              organizationId: member.organizationId,
              jobId: input.jobId ?? null,
              type: input.type,
              description: input.description,
              detectedBy: session.user.id,
              detectedAt: new Date(input.detectedAt),
              status: "open",
              createdBy: session.user.id,
            })
            .returning();
          newNc = inserted ?? null;
          break;
        } catch (err) {
          if (!isUniqueViolation(err) || attempt === MAX_SEQ_RETRIES - 1)
            throw err;
        }
      }

      if (!newNc) {
        return c.json({ error: "Falha ao criar nao conformidade" }, 500);
      }

      // Audit log
      await db.insert(nonConformanceAuditLog).values({
        ncId: newNc.id,
        action: "create",
        changes: { initial: input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Notify admins/owners of new NC (fire-and-forget)
      notifyNCCreated(
        newNc.id,
        newNc.ncNumber,
        newNc.type,
        newNc.description,
        member.organizationId,
        session.user.id,
      ).catch((err) => console.error("[NC] Failed to send notification:", err));

      return c.json(newNc, 201);
    },
  )

  // =========================================================================
  // PUT /:id/disposition - Set disposition on an NC
  // =========================================================================
  .put(
    "/:id/disposition",
    ...withLabPermission({ non_conformance: ["update"] }),
    zValidator("json", SetDispositionSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing NC
      const [existing] = await db
        .select()
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Nao conformidade nao encontrada" }, 404);
      }

      if (existing.status === "resolved") {
        return c.json({ error: "Nao conformidade ja foi resolvida" }, 400);
      }

      // For "use_as_is" and "concession", require admin/owner role
      const requiresApproval =
        input.disposition === "use_as_is" || input.disposition === "concession";

      if (
        requiresApproval &&
        member.role !== "admin" &&
        member.role !== "owner"
      ) {
        return c.json(
          {
            error:
              "Disposicao 'uso como esta' ou 'concessao' requer aprovacao do gerente tecnico",
          },
          403,
        );
      }

      // Update NC
      const updateData: Record<string, unknown> = {
        disposition: input.disposition,
        dispositionJustification: input.justification || null,
        status: "under_review" as const,
      };

      // If requires approval and user is admin/owner, auto-approve
      if (requiresApproval) {
        updateData.dispositionApprovedBy = session.user.id;
        updateData.dispositionApprovedAt = new Date();
      }

      const [updated] = await db
        .update(nonConformance)
        .set(updateData)
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .returning();

      // Audit log
      await db.insert(nonConformanceAuditLog).values({
        ncId: id,
        action: "disposition",
        changes: {
          disposition: { old: existing.disposition, new: input.disposition },
          justification: {
            old: existing.dispositionJustification,
            new: input.justification || null,
          },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.justification || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/resolve - Resolve/close an NC
  // =========================================================================
  .post(
    "/:id/resolve",
    ...withLabPermission({ non_conformance: ["update"] }),
    zValidator("json", ResolveNonConformanceSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Nao conformidade nao encontrada" }, 404);
      }

      if (existing.status === "resolved") {
        return c.json({ error: "Nao conformidade ja foi resolvida" }, 400);
      }

      if (!existing.disposition) {
        return c.json(
          { error: "Defina a disposicao antes de resolver a nao conformidade" },
          400,
        );
      }

      const [updated] = await db
        .update(nonConformance)
        .set({
          correctionTaken: input.correctionTaken,
          resolvedAt: new Date(),
          resolvedBy: session.user.id,
          status: "resolved",
        })
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .returning();

      // Audit log
      await db.insert(nonConformanceAuditLog).values({
        ncId: id,
        action: "resolve",
        changes: {
          status: { old: existing.status, new: "resolved" },
          correctionTaken: {
            old: existing.correctionTaken,
            new: input.correctionTaken,
          },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({
        message: "Nao conformidade resolvida com sucesso",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/escalate-to-capa - Create CAPA from NC
  // =========================================================================
  .post(
    "/:id/escalate-to-capa",
    ...withLabPermission({ non_conformance: ["escalate"] }),
    zValidator("json", EscalateToCapaSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Nao conformidade nao encontrada" }, 404);
      }

      if (existing.capaId) {
        return c.json(
          { error: "Nao conformidade ja possui CAPA vinculada" },
          400,
        );
      }

      // Generate CAPA number with retry on unique constraint violation
      let newCapa: typeof correctiveAction.$inferSelect | null = null;
      for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
        const year = new Date().getFullYear();
        const [lastCapa] = await db
          .select({ capaNumber: correctiveAction.capaNumber })
          .from(correctiveAction)
          .where(
            and(
              eq(correctiveAction.organizationId, member.organizationId),
              ilike(correctiveAction.capaNumber, `CAPA-${year}-%`),
            ),
          )
          .orderBy(desc(correctiveAction.capaNumber))
          .limit(1);

        let nextSeq = 1;
        if (lastCapa) {
          const parts = lastCapa.capaNumber.split("-");
          nextSeq = parseInt(parts[2] ?? "0", 10) + 1;
        }
        const capaNumber = `CAPA-${year}-${String(nextSeq).padStart(4, "0")}`;

        try {
          const [inserted] = await db
            .insert(correctiveAction)
            .values({
              capaNumber,
              organizationId: member.organizationId,
              title: `CAPA originada da ${existing.ncNumber}`,
              description: existing.description,
              source: "nc_detection",
              sourceReference: existing.ncNumber,
              detectionDate: existing.detectedAt,
              rootCauseAnalysis: input.rootCauseAnalysis || null,
              actionPlan: input.actionPlan || null,
              responsibleId: input.responsibleId || null,
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              status: "OPEN",
              createdBy: session.user.id,
            })
            .returning();
          newCapa = inserted ?? null;
          break;
        } catch (err) {
          if (!isUniqueViolation(err) || attempt === MAX_SEQ_RETRIES - 1)
            throw err;
        }
      }

      if (!newCapa) {
        return c.json({ error: "Falha ao criar CAPA" }, 500);
      }

      // Link NC to CAPA
      await db
        .update(nonConformance)
        .set({ capaId: newCapa.id })
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        );

      // Audit log
      await db.insert(nonConformanceAuditLog).values({
        ncId: id,
        action: "escalate_to_capa",
        changes: {
          capaId: { old: null, new: newCapa.id },
          capaNumber: newCapa.capaNumber,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Notify admins/owners of escalation (fire-and-forget)
      notifyNCEscalatedToCapa(
        id,
        existing.ncNumber,
        newCapa.id,
        newCapa.capaNumber,
        existing.description,
        member.organizationId,
        session.user.id,
      ).catch((err) =>
        console.error("[NC] Failed to send escalation notification:", err),
      );

      return c.json(
        {
          message: "CAPA criada com sucesso",
          data: {
            nc: { ...existing, capaId: newCapa.id },
            capa: newCapa,
          },
        },
        201,
      );
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for an NC
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Verify NC exists and belongs to organization
      const [existing] = await db
        .select({ id: nonConformance.id })
        .from(nonConformance)
        .where(
          and(
            eq(nonConformance.id, id),
            eq(nonConformance.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Nao conformidade nao encontrada" }, 404);
      }

      const logs = await db
        .select()
        .from(nonConformanceAuditLog)
        .where(eq(nonConformanceAuditLog.ncId, id))
        .orderBy(desc(nonConformanceAuditLog.performedAt));

      return c.json({ data: logs });
    },
  );
