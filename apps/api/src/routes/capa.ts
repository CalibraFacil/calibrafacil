import { createRouter } from "../server/router";
import { capaEndpoints } from "@calibra-facil/contracts";
import {
  correctiveAction,
  correctiveActionAuditLog,
  type CapaVerificationIndependence,
  nonConformance,
  user,
} from "@calibra-facil/db/schema";
import { CAPA_INDEPENDENCE_JUSTIFICATION_MIN_LENGTH } from "@calibra-facil/schemas";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  createCorrectiveActionRecord,
  requireLabCapa,
} from "../lib/corrective-actions";
import { userIsOrganizationMember } from "../lib/tenant-refs";
import { mount } from "../lib/endpoint-mount";
import { requireRouteId } from "../lib/route-id";
import { orgDb } from "../lib/org-db";
import { conflict, forbidden, invalid } from "../lib/domain-errors";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
import { assessCapaVerifierIndependence } from "../lib/capa-verification-independence";
import { eq, and, or, ilike, desc, count, lte, sql } from "drizzle-orm";
import { CORRECTIVE_ACTION_MACHINE } from "@calibra-facil/schemas/machines";

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
const RESPONSIBLE_REFUSED =
  "Responsavel nao encontrado ou nao pertence a organizacao";

const PREFIX = "/api/capa";

export const capaRouter = createRouter<{ Variables: AuthVariables }>();

// =========================================================================
// GET / - List CAPAs with pagination and filtering
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.list,
  withLabPermission({ capa: ["read"] }),
  async (
    c,
    {
      query: {
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
      },
    },
  ) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const member = c.get("member");
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

      const [countResult] = await o
        .select({ total: count() })
        .from(correctiveAction)
        .where(whereCondition);

      const capas = await o
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

      return {
        data: capasWithAge,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      };
    });
  },
);

// =========================================================================
// GET /summary - Dashboard summary
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.summary,
  withLabPermission({ capa: ["read"] }),
  async (c) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const member = c.get("member");
      const orgId = member.organizationId;

      // Count by status
      const statusCounts = await o
        .select({
          status: correctiveAction.status,
          count: count(),
        })
        .from(correctiveAction)
        .where(eq(correctiveAction.organizationId, orgId))
        .groupBy(correctiveAction.status);

      // Count by severity (non-closed)
      const severityCounts = await o
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
      const categoryCounts = await o
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
      const [overdueResult] = await o
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
      const [totalClosed] = await o
        .select({ count: count() })
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.organizationId, orgId),
            eq(correctiveAction.status, "CLOSED"),
          ),
        );

      const [effectiveCount] = await o
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

      return {
        byStatus: statusCounts,
        bySeverity: severityCounts,
        byCategory: categoryCounts,
        overdue: overdueResult?.count ?? 0,
        effectivenessRate,
        totalClosed: totalClosed?.count ?? 0,
      };
    });
  },
);

// =========================================================================
// GET /:id/label - Get CAPA label by ID
// =========================================================================
capaRouter.get(
  "/:id/label",
  ...withLabPermission({ capa: ["read"] }),
  async (c) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const capa = await requireLabCapa(o, requireRouteId(c.req.param("id")));
      return c.json({ id: capa.id, label: capa.capaNumber });
    });
  },
);

// =========================================================================
// GET /:id - Get single CAPA by ID
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.get,
  withLabPermission({ capa: ["read"] }),
  async (c, { params }) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      const capa = await requireLabCapa(o, params.id);

      // Get linked NCs
      const linkedNCs = await o
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
        const users = await o
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(or(...userIds.map((uid) => eq(user.id, uid))));

        for (const u of users) {
          userNames[u.id] = u.name;
        }
      }

      const now = new Date();

      return {
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
              (now.getTime() - capa.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
        isOverdue:
          capa.dueDate &&
          capa.dueDate < now &&
          capa.status !== "CLOSED" &&
          capa.status !== "VERIFICATION",
      };
    });
  },
);

// =========================================================================
// POST / - Create new CAPA
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.create,
  withLabPermission({ capa: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");
    const session = c.get("session");

    const newCapa = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        // The responsible is a body-supplied user id: a member of THIS org only
        // (otherwise GET /:id would resolve another tenant's user name).
        if (
          input.responsibleId &&
          !(await userIsOrganizationMember(
            member.organizationId,
            input.responsibleId,
            ctx.o,
          ))
        ) {
          throw invalid("invalid_request", RESPONSIBLE_REFUSED);
        }

        return createCorrectiveActionRecord(
          {
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
            ipAddress: ctx.actor.ipAddress,
            auditChanges: { initial: input },
          },
          ctx.o,
        );
      },
    );

    return newCapa;
  },
);

// =========================================================================
// PUT /:id - Update CAPA
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.update,
  withLabPermission({ capa: ["update"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCapa(ctx.o, params.id);
        const id = existing.id;

        if (!CORRECTIVE_ACTION_MACHINE.canTransition(existing.status, "edit")) {
          throw invalid("invalid_request", "CAPA fechada nao pode ser editada");
        }

        if (
          input.responsibleId &&
          input.responsibleId !== existing.responsibleId &&
          !(await userIsOrganizationMember(
            member.organizationId,
            input.responsibleId,
            ctx.o,
          ))
        ) {
          throw invalid("invalid_request", RESPONSIBLE_REFUSED);
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
        if (
          input.rootCauseAnalysis &&
          CORRECTIVE_ACTION_MACHINE.canTransition(
            existing.status,
            "investigate",
          )
        ) {
          updateData.status = CORRECTIVE_ACTION_MACHINE.requireTargetOf(
            existing.status,
            "investigate",
          );
          updateData.investigationCompletedAt = new Date();
        }

        const [row] = await ctx.o
          .update(correctiveAction)
          .set(updateData)
          // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
          // above so the UPDATE stays org-scoped even if the guarding read is
          // refactored away. Reuses the in-scope member.organizationId.
          .where(
            and(
              eq(correctiveAction.id, id),
              eq(correctiveAction.organizationId, member.organizationId),
              eq(correctiveAction.status, existing.status),
            ),
          )
          .returning();
        if (!row) {
          // The compare-and-set on the status matched no row: the CAPA moved
          // under the caller (CORRECTIVE_ACTION_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A CAPA mudou de status durante a operacao. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("correctiveAction", id, {
          action: "update",
          changes: { before: existing, after: input },
        });

        return row;
      },
    );

    return updated;
  },
);

// =========================================================================
// POST /:id/implement - Mark CAPA as implemented
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.implement,
  withLabPermission({ capa: ["implement"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCapa(ctx.o, params.id);
        const id = existing.id;

        if (
          !CORRECTIVE_ACTION_MACHINE.canTransition(existing.status, "implement")
        ) {
          throw invalid(
            "invalid_request",
            "CAPA deve estar em status OPEN, INVESTIGATION ou IMPLEMENTATION para ser implementada",
          );
        }

        const [row] = await ctx.o
          .update(correctiveAction)
          .set({
            implementationEvidence: input.implementationEvidence,
            implementedAt: new Date(),
            status: CORRECTIVE_ACTION_MACHINE.requireTargetOf(
              existing.status,
              "implement",
            ),
          })
          // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
          // above so the UPDATE stays org-scoped even if the guarding read is
          // refactored away. Reuses the in-scope member.organizationId.
          .where(
            and(
              eq(correctiveAction.id, id),
              eq(correctiveAction.organizationId, member.organizationId),
              eq(correctiveAction.status, existing.status),
            ),
          )
          .returning();
        if (!row) {
          // The compare-and-set on the status matched no row: the CAPA moved
          // under the caller (CORRECTIVE_ACTION_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A CAPA mudou de status durante a operacao. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("correctiveAction", id, {
          action: "implement",
          changes: {
            status: { old: existing.status, new: "IMPLEMENTATION" },
            implementationEvidence: input.implementationEvidence,
          },
        });

        return row;
      },
    );

    return {
      message: "CAPA marcada como implementada",
      data: updated,
    };
  },
);

// =========================================================================
// POST /:id/verify - Verify CAPA effectiveness
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.verify,
  withLabPermission({ capa: ["verify"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const session = c.get("session");

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCapa(ctx.o, params.id);
        const id = existing.id;

        if (
          !CORRECTIVE_ACTION_MACHINE.canTransition(existing.status, "verify")
        ) {
          throw invalid(
            "invalid_request",
            "CAPA deve estar em status IMPLEMENTATION para verificacao de eficacia",
          );
        }
        // After an ineffective verification the CAPA is back in implementation
        // with no implementation recorded: a new one comes before a new check.
        if (!existing.implementedAt) {
          throw invalid(
            "invalid_request",
            "Registre a implementação das ações antes de verificar a eficácia",
          );
        }

        // Separation of duties (ISO/IEC 17025 §8.7, decision Q50): the verifier
        // is independent of the CAPA, i.e. neither its owner now or ever nor
        // anyone who implemented it. A lab with no other eligible verifier lets
        // the sole one verify with a written justification (recorded, flagged).
        const independence = await assessCapaVerifierIndependence(ctx.o, {
          organizationId: member.organizationId,
          capaId: id,
          currentResponsibleId: existing.responsibleId,
          verifierUserId: session.user.id,
        });
        const waived =
          independence.status === "waivable" &&
          !!input.independenceJustification;
        if (
          independence.status === "blocked" ||
          (independence.status === "waivable" && !waived)
        ) {
          throw forbidden(
            "self_approval_blocked",
            independence.status === "waivable"
              ? `Separação de responsabilidades (ISO/IEC 17025): você é responsável pela CAPA ou registrou sua implementação, mas é o único verificador disponível. Informe a justificativa (mínimo ${CAPA_INDEPENDENCE_JUSTIFICATION_MIN_LENGTH} caracteres) para verificar sem independência.`
              : "Separação de responsabilidades (ISO/IEC 17025): quem é ou já foi responsável pela CAPA, ou registrou sua implementação, não pode verificar a eficácia. Solicite a verificação a outro membro autorizado.",
            {
              details: {
                independence_waiver_available:
                  independence.status === "waivable",
              },
            },
          );
        }
        const verificationIndependence: CapaVerificationIndependence = waived
          ? "waived_single_verifier"
          : "independent";

        // `verify` (CORRECTIVE_ACTION_MACHINE): effective → VERIFICATION, not
        // effective → back to IMPLEMENTATION (decision Q61).
        const verifiedStatus = CORRECTIVE_ACTION_MACHINE.requireTransition(
          existing.status,
          "verify",
          input.effectivenessConfirmed ? "VERIFICATION" : "IMPLEMENTATION",
        );
        const [row] = await ctx.o
          .update(correctiveAction)
          .set({
            verifiedAt: new Date(),
            verifiedBy: session.user.id,
            verificationNotes: input.verificationNotes,
            effectivenessConfirmed: input.effectivenessConfirmed,
            verificationIndependence,
            verificationIndependenceJustification: waived
              ? (input.independenceJustification ?? null)
              : null,
            status: verifiedStatus,
            // Not effective: a new implementation cycle starts, so the previous
            // implementation is cleared from the row (the audit log keeps it).
            ...(input.effectivenessConfirmed
              ? {}
              : { implementedAt: null, implementationEvidence: null }),
          })
          // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
          // above so the UPDATE stays org-scoped even if the guarding read is
          // refactored away. Reuses the in-scope member.organizationId.
          .where(
            and(
              eq(correctiveAction.id, id),
              eq(correctiveAction.organizationId, member.organizationId),
              eq(correctiveAction.status, existing.status),
            ),
          )
          .returning();
        if (!row) {
          // The compare-and-set on the status matched no row: the CAPA moved
          // under the caller (CORRECTIVE_ACTION_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A CAPA mudou de status durante a operacao. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("correctiveAction", id, {
          action: "verify",
          changes: {
            status: { old: existing.status, new: verifiedStatus },
            effectivenessConfirmed: input.effectivenessConfirmed,
            verificationNotes: input.verificationNotes,
            verification_independence: verificationIndependence,
            ...(waived
              ? { independenceJustification: input.independenceJustification }
              : {}),
          },
        });

        return row;
      },
    );

    return {
      message: "Verificacao de eficacia registrada",
      data: updated,
    };
  },
);

// =========================================================================
// POST /:id/close - Close CAPA
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.close,
  withLabPermission({ capa: ["close"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const session = c.get("session");

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabCapa(ctx.o, params.id);
        const id = existing.id;

        if (
          !CORRECTIVE_ACTION_MACHINE.canTransition(existing.status, "close")
        ) {
          throw invalid(
            "invalid_request",
            "CAPA deve estar em status VERIFICATION para ser fechada",
          );
        }

        const [row] = await ctx.o
          .update(correctiveAction)
          .set({
            status: CORRECTIVE_ACTION_MACHINE.requireTargetOf(
              existing.status,
              "close",
            ),
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
              eq(correctiveAction.status, existing.status),
            ),
          )
          .returning();
        if (!row) {
          // The compare-and-set on the status matched no row: the CAPA moved
          // under the caller (CORRECTIVE_ACTION_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "A CAPA mudou de status durante a operacao. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("correctiveAction", id, {
          action: "close",
          changes: {
            status: { old: existing.status, new: "CLOSED" },
            reason: input.reason,
          },
          reason: input.reason || null,
        });

        return row;
      },
    );

    return {
      message: "CAPA fechada com sucesso",
      data: updated,
    };
  },
);

// =========================================================================
// GET /:id/audit-log - Get audit log for a CAPA
// =========================================================================
mount(
  capaRouter,
  PREFIX,
  capaEndpoints.auditLog,
  withLabPermission({ capa: ["read"] }),
  async (c, { params }) => {
    return orgDb(c.get("member").organizationId).transaction(async (o) => {
      // Verify CAPA exists and belongs to organization
      const { id } = await requireLabCapa(o, params.id);

      const logs = await o
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

      return { data: logs };
    });
  },
);
