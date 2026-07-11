import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  correctiveActionAuditLog,
  nonConformance,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateCorrectiveActionSchema,
  UpdateCorrectiveActionSchema,
  ImplementCorrectiveActionSchema,
  VerifyCorrectiveActionSchema,
  CloseCorrectiveActionSchema,
  ListCorrectiveActionsQuerySchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { createCorrectiveActionRecord } from "../lib/corrective-actions";
import { eq, and, or, ilike, desc, count, lte, sql } from "drizzle-orm";

/**
 * CAPA Router - ISO 17025:2017 Clause 8.2 (Corrective Actions)
 *
 * Full CAPA lifecycle: OPEN -> INVESTIGATION -> IMPLEMENTATION -> VERIFICATION -> CLOSED
 *
 * Permissions:
 * - GET /: capa:read (all roles)
 * - GET /summary: capa:read (all roles)
 * - GET /:id: capa:read (all roles)
 * - POST /: capa:create (technician, admin, owner)
 * - PUT /:id: capa:update (technician, admin, owner)
 * - POST /:id/implement: capa:implement (technician, admin, owner)
 * - POST /:id/verify: capa:verify (admin, owner)
 * - POST /:id/close: capa:close (admin, owner)
 * - GET /:id/audit-log: capa:read (all roles)
 */
export const capaRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List CAPAs with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ capa: ["read"] }),
    zValidator("query", ListCorrectiveActionsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const {
        page,
        limit,
        query,
        status,
        severity,
        category,
        source,
        type,
        responsibleId,
        overdue,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(correctiveAction.organizationId, member.organizationId),
      ];

      if (query) {
        conditions.push(
          or(
            ilike(correctiveAction.capaNumber, `%${query}%`),
            ilike(correctiveAction.title, `%${query}%`),
            ilike(correctiveAction.description, `%${query}%`),
          )!,
        );
      }

      if (status) {
        conditions.push(eq(correctiveAction.status, status));
      }

      if (severity) {
        conditions.push(eq(correctiveAction.severity, severity));
      }

      if (category) {
        conditions.push(eq(correctiveAction.category, category));
      }

      if (source) {
        conditions.push(eq(correctiveAction.source, source));
      }

      if (type) {
        conditions.push(eq(correctiveAction.type, type));
      }

      if (responsibleId) {
        conditions.push(eq(correctiveAction.responsibleId, responsibleId));
      }

      if (overdue) {
        conditions.push(
          and(
            lte(correctiveAction.dueDate, new Date()),
            or(
              eq(correctiveAction.status, "OPEN"),
              eq(correctiveAction.status, "INVESTIGATION"),
              eq(correctiveAction.status, "IMPLEMENTATION"),
            ),
          )!,
        );
      }

      const whereCondition = and(...conditions);

      const [countResult] = await db
        .select({ total: count() })
        .from(correctiveAction)
        .where(whereCondition);

      const capas = await db
        .select({
          id: correctiveAction.id,
          capaNumber: correctiveAction.capaNumber,
          source: correctiveAction.source,
          sourceReference: correctiveAction.sourceReference,
          title: correctiveAction.title,
          description: correctiveAction.description,
          detectionDate: correctiveAction.detectionDate,
          type: correctiveAction.type,
          severity: correctiveAction.severity,
          category: correctiveAction.category,
          status: correctiveAction.status,
          responsibleId: correctiveAction.responsibleId,
          dueDate: correctiveAction.dueDate,
          implementedAt: correctiveAction.implementedAt,
          verifiedAt: correctiveAction.verifiedAt,
          closedAt: correctiveAction.closedAt,
          effectivenessConfirmed: correctiveAction.effectivenessConfirmed,
          createdAt: correctiveAction.createdAt,
          updatedAt: correctiveAction.updatedAt,
          responsibleName: user.name,
        })
        .from(correctiveAction)
        .leftJoin(user, eq(correctiveAction.responsibleId, user.id))
        .where(whereCondition)
        .orderBy(desc(correctiveAction.createdAt))
        .limit(limit)
        .offset(offset);

      const now = new Date();
      const capasWithAge = capas.map((capa) => ({
        ...capa,
        ageDays: capa.detectionDate
          ? Math.ceil(
              (now.getTime() - capa.detectionDate.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : Math.ceil(
              (now.getTime() - capa.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
        isOverdue:
          capa.dueDate &&
          capa.dueDate < now &&
          capa.status !== "CLOSED" &&
          capa.status !== "VERIFICATION",
      }));

      return c.json({
        data: capasWithAge,
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
  // GET /summary - Dashboard summary
  // =========================================================================
  .get("/summary", ...withLabPermission({ capa: ["read"] }), async (c) => {
    const member = c.get("member");
    const orgId = member.organizationId;

    // Count by status
    const statusCounts = await db
      .select({
        status: correctiveAction.status,
        count: count(),
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.organizationId, orgId))
      .groupBy(correctiveAction.status);

    // Count by severity (non-closed)
    const severityCounts = await db
      .select({
        severity: correctiveAction.severity,
        count: count(),
      })
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.organizationId, orgId),
          sql`${correctiveAction.status} != 'CLOSED'`,
        ),
      )
      .groupBy(correctiveAction.severity);

    // Count by category (non-closed)
    const categoryCounts = await db
      .select({
        category: correctiveAction.category,
        count: count(),
      })
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.organizationId, orgId),
          sql`${correctiveAction.status} != 'CLOSED'`,
        ),
      )
      .groupBy(correctiveAction.category);

    // Count overdue
    const now = new Date();
    const [overdueResult] = await db
      .select({ count: count() })
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.organizationId, orgId),
          lte(correctiveAction.dueDate, now),
          or(
            eq(correctiveAction.status, "OPEN"),
            eq(correctiveAction.status, "INVESTIGATION"),
            eq(correctiveAction.status, "IMPLEMENTATION"),
          ),
        ),
      );

    // Effectiveness rate (closed CAPAs with verification)
    const [totalClosed] = await db
      .select({ count: count() })
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.organizationId, orgId),
          eq(correctiveAction.status, "CLOSED"),
        ),
      );

    const [effectiveCount] = await db
      .select({ count: count() })
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.organizationId, orgId),
          eq(correctiveAction.status, "CLOSED"),
          eq(correctiveAction.effectivenessConfirmed, true),
        ),
      );

    const effectivenessRate =
      (totalClosed?.count ?? 0) > 0
        ? Math.round(
            ((effectiveCount?.count ?? 0) / (totalClosed?.count ?? 1)) * 100,
          )
        : 0;

    return c.json({
      byStatus: statusCounts,
      bySeverity: severityCounts,
      byCategory: categoryCounts,
      overdue: overdueResult?.count ?? 0,
      effectivenessRate,
      totalClosed: totalClosed?.count ?? 0,
    });
  })

  // =========================================================================
  // GET /:id/label - Get CAPA label by ID
  // =========================================================================
  .get("/:id/label", ...withLabPermission({ capa: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [capa] = await db
      .select({
        id: correctiveAction.id,
        label: correctiveAction.capaNumber,
      })
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.id, id),
          eq(correctiveAction.organizationId, member.organizationId),
        ),
      )
      .limit(1);

    if (!capa) {
      return c.json({ error: "CAPA nao encontrada" }, 404);
    }

    return c.json(capa);
  })

  // =========================================================================
  // GET /:id - Get single CAPA by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ capa: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [capa] = await db
      .select()
      .from(correctiveAction)
      .where(
        and(
          eq(correctiveAction.id, id),
          eq(correctiveAction.organizationId, member.organizationId),
        ),
      )
      .limit(1);

    if (!capa) {
      return c.json({ error: "CAPA nao encontrada" }, 404);
    }

    // Get linked NCs
    const linkedNCs = await db
      .select({
        id: nonConformance.id,
        ncNumber: nonConformance.ncNumber,
        type: nonConformance.type,
        description: nonConformance.description,
        status: nonConformance.status,
        detectedAt: nonConformance.detectedAt,
      })
      .from(nonConformance)
      .where(eq(nonConformance.capaId, capa.id));

    // Get user names
    const userNames: Record<string, string | null> = {};

    const userIds = [
      capa.responsibleId,
      capa.verifiedBy,
      capa.closedBy,
      capa.createdBy,
    ].filter((userId): userId is string => Boolean(userId));

    if (userIds.length > 0) {
      const users = await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(or(...userIds.map((uid) => eq(user.id, uid))));

      for (const u of users) {
        userNames[u.id] = u.name;
      }
    }

    const now = new Date();

    return c.json({
      ...capa,
      responsibleName: capa.responsibleId
        ? (userNames[capa.responsibleId] ?? null)
        : null,
      verifiedByName: capa.verifiedBy
        ? (userNames[capa.verifiedBy] ?? null)
        : null,
      closedByName: capa.closedBy ? (userNames[capa.closedBy] ?? null) : null,
      createdByName: userNames[capa.createdBy] ?? null,
      linkedNCs,
      ageDays: capa.detectionDate
        ? Math.ceil(
            (now.getTime() - capa.detectionDate.getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : Math.ceil(
            (now.getTime() - capa.createdAt.getTime()) / (1000 * 60 * 60 * 24),
          ),
      isOverdue:
        capa.dueDate &&
        capa.dueDate < now &&
        capa.status !== "CLOSED" &&
        capa.status !== "VERIFICATION",
    });
  })

  // =========================================================================
  // POST / - Create new CAPA
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ capa: ["create"] }),
    zValidator("json", CreateCorrectiveActionSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const newCapa = await createCorrectiveActionRecord({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        source: input.source,
        sourceReference: input.sourceReference || null,
        title: input.title,
        description: input.description,
        detectionDate: new Date(input.detectionDate),
        type: input.type,
        severity: input.severity,
        category: input.category,
        rootCauseAnalysis: input.rootCauseAnalysis ?? null,
        rootCauseAnalysisMethod: input.rootCauseAnalysisMethod ?? null,
        actionPlan: input.actionPlan,
        preventiveMeasures: input.preventiveMeasures ?? null,
        responsibleId: input.responsibleId,
        dueDate: new Date(input.dueDate),
        ipAddress: c.req.header("x-forwarded-for") || null,
        auditChanges: { initial: input },
      });

      return c.json(newCapa, 201);
    },
  )

  // =========================================================================
  // PUT /:id - Update CAPA
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ capa: ["update"] }),
    zValidator("json", UpdateCorrectiveActionSchema),
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
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "CAPA nao encontrada" }, 404);
      }

      if (existing.status === "CLOSED") {
        return c.json({ error: "CAPA fechada nao pode ser editada" }, 400);
      }

      const updateData: Record<string, unknown> = {};

      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.source !== undefined) updateData.source = input.source;
      if (input.sourceReference !== undefined)
        updateData.sourceReference = input.sourceReference || null;
      if (input.type !== undefined) updateData.type = input.type;
      if (input.severity !== undefined) updateData.severity = input.severity;
      if (input.category !== undefined) updateData.category = input.category;
      if (input.actionPlan !== undefined)
        updateData.actionPlan = input.actionPlan;
      if (input.responsibleId !== undefined)
        updateData.responsibleId = input.responsibleId;
      if (input.dueDate !== undefined)
        updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      if (input.rootCauseAnalysis !== undefined)
        updateData.rootCauseAnalysis = input.rootCauseAnalysis;
      if (input.rootCauseAnalysisMethod !== undefined)
        updateData.rootCauseAnalysisMethod = input.rootCauseAnalysisMethod;
      if (input.preventiveMeasures !== undefined)
        updateData.preventiveMeasures = input.preventiveMeasures;

      // Auto-transition to INVESTIGATION when root cause is added
      if (input.rootCauseAnalysis && existing.status === "OPEN") {
        updateData.status = "INVESTIGATION";
        updateData.investigationCompletedAt = new Date();
      }

      const [updated] = await db
        .update(correctiveAction)
        .set(updateData)
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .returning();

      // Audit log
      await db.insert(correctiveActionAuditLog).values({
        capaId: id,
        action: "update",
        changes: { before: existing, after: input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/implement - Mark CAPA as implemented
  // =========================================================================
  .post(
    "/:id/implement",
    ...withLabPermission({ capa: ["implement"] }),
    zValidator("json", ImplementCorrectiveActionSchema),
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
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "CAPA nao encontrada" }, 404);
      }

      if (
        existing.status !== "OPEN" &&
        existing.status !== "INVESTIGATION" &&
        existing.status !== "IMPLEMENTATION"
      ) {
        return c.json(
          {
            error:
              "CAPA deve estar em status OPEN, INVESTIGATION ou IMPLEMENTATION para ser implementada",
          },
          400,
        );
      }

      const [updated] = await db
        .update(correctiveAction)
        .set({
          implementationEvidence: input.implementationEvidence,
          implementedAt: new Date(),
          status: "IMPLEMENTATION",
        })
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .returning();

      // Audit log
      await db.insert(correctiveActionAuditLog).values({
        capaId: id,
        action: "implement",
        changes: {
          status: { old: existing.status, new: "IMPLEMENTATION" },
          implementationEvidence: input.implementationEvidence,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({
        message: "CAPA marcada como implementada",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/verify - Verify CAPA effectiveness
  // =========================================================================
  .post(
    "/:id/verify",
    ...withLabPermission({ capa: ["verify"] }),
    zValidator("json", VerifyCorrectiveActionSchema),
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
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "CAPA nao encontrada" }, 404);
      }

      if (existing.status !== "IMPLEMENTATION") {
        return c.json(
          {
            error:
              "CAPA deve estar em status IMPLEMENTATION para verificacao de eficacia",
          },
          400,
        );
      }

      const [updated] = await db
        .update(correctiveAction)
        .set({
          verifiedAt: new Date(),
          verifiedBy: session.user.id,
          verificationNotes: input.verificationNotes,
          effectivenessConfirmed: input.effectivenessConfirmed,
          status: "VERIFICATION",
        })
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .returning();

      // Audit log
      await db.insert(correctiveActionAuditLog).values({
        capaId: id,
        action: "verify",
        changes: {
          status: { old: existing.status, new: "VERIFICATION" },
          effectivenessConfirmed: input.effectivenessConfirmed,
          verificationNotes: input.verificationNotes,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({
        message: "Verificacao de eficacia registrada",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/close - Close CAPA
  // =========================================================================
  .post(
    "/:id/close",
    ...withLabPermission({ capa: ["close"] }),
    zValidator("json", CloseCorrectiveActionSchema),
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
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "CAPA nao encontrada" }, 404);
      }

      if (existing.status !== "VERIFICATION") {
        return c.json(
          {
            error: "CAPA deve estar em status VERIFICATION para ser fechada",
          },
          400,
        );
      }

      const [updated] = await db
        .update(correctiveAction)
        .set({
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: session.user.id,
        })
        // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
        // above so the UPDATE stays org-scoped even if the guarding read is
        // refactored away. Reuses the in-scope member.organizationId.
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .returning();

      // Audit log
      await db.insert(correctiveActionAuditLog).values({
        capaId: id,
        action: "close",
        changes: {
          status: { old: existing.status, new: "CLOSED" },
          reason: input.reason,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason || null,
      });

      return c.json({
        message: "CAPA fechada com sucesso",
        data: updated,
      });
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for a CAPA
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ capa: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Verify CAPA exists and belongs to organization
      const [existing] = await db
        .select({ id: correctiveAction.id })
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.id, id),
            eq(correctiveAction.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "CAPA nao encontrada" }, 404);
      }

      const logs = await db
        .select({
          id: correctiveActionAuditLog.id,
          capaId: correctiveActionAuditLog.capaId,
          action: correctiveActionAuditLog.action,
          changes: correctiveActionAuditLog.changes,
          performedBy: correctiveActionAuditLog.performedBy,
          performedAt: correctiveActionAuditLog.performedAt,
          ipAddress: correctiveActionAuditLog.ipAddress,
          reason: correctiveActionAuditLog.reason,
          performedByName: user.name,
        })
        .from(correctiveActionAuditLog)
        .leftJoin(user, eq(correctiveActionAuditLog.performedBy, user.id))
        .where(eq(correctiveActionAuditLog.capaId, id))
        .orderBy(desc(correctiveActionAuditLog.performedAt));

      return c.json({ data: logs });
    },
  );
