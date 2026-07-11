import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  proficiencyTest,
  proficiencyTestAuditLog,
  ptPlanItem,
  referenceStandard,
  user,
  type PtOverallStatus,
  type PtResultPoint,
  type PtScoreVerdict,
} from "@calibra-facil/db/schema";
import {
  CreateProficiencyTestSchema,
  UpdateProficiencyTestSchema,
  RecordPtResultsSchema,
  ListProficiencyTestsQuerySchema,
  CreatePtPlanItemSchema,
  UpdatePtPlanItemSchema,
  type PtResultPointInput,
} from "@calibra-facil/schemas";
import {
  classifyScore,
  enScore,
  zetaScore,
  zPrimeScore,
  zScore,
} from "@calibra-facil/interval-analysis";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { createCorrectiveActionRecord } from "../lib/corrective-actions";
import { eq, and, or, ilike, desc, asc, count } from "drizzle-orm";

/**
 * Proficiency Testing Router - ISO/IEC 17025 §7.7.2 (issue #60 Phase 0)
 *
 * PT register (rounds + provider reports scored per ISO 13528) and the
 * risk-based participation plan (NIT-DICLA-026 §9.4, 4-year default cycle).
 * Unsatisfactory results auto-open a CAPA (§7.7.3).
 */

function computeResultPoint(point: PtResultPointInput): PtResultPoint {
  let score: number | null = null;
  if (point.scoreType === "en") {
    score = enScore(
      point.labValue,
      point.refValue,
      point.labUncertainty ?? 0,
      point.refUncertainty ?? 0,
    );
  } else if (point.scoreType === "z") {
    score = zScore(point.labValue, point.refValue, point.sigmaPt ?? 0);
  } else if (point.scoreType === "z_prime") {
    score = zPrimeScore(
      point.labValue,
      point.refValue,
      point.sigmaPt ?? 0,
      point.refUncertainty ?? 0,
    );
  } else {
    score = zetaScore(
      point.labValue,
      point.refValue,
      point.labUncertainty ?? 0,
      point.refUncertainty ?? 0,
    );
  }
  // An uncomputable score must never read as a pass (§7.7.3).
  const verdict: PtScoreVerdict =
    score === null ? "unsatisfactory" : classifyScore(point.scoreType, score);
  return {
    label: point.label,
    unit: point.unit ?? null,
    labValue: point.labValue,
    labUncertainty: point.labUncertainty ?? null,
    refValue: point.refValue,
    refUncertainty: point.refUncertainty ?? null,
    sigmaPt: point.sigmaPt ?? null,
    scoreType: point.scoreType,
    score,
    verdict,
  };
}

function overallStatusFromResults(results: PtResultPoint[]): PtOverallStatus {
  if (results.some((r) => r.verdict === "unsatisfactory")) {
    return "unsatisfactory";
  }
  if (results.some((r) => r.verdict === "questionable")) {
    return "questionable";
  }
  return "satisfactory";
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

export const proficiencyTestsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List PT rounds with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ proficiency_test: ["read"] }),
    zValidator("query", ListProficiencyTestsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, status, activityType, scopePart } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(proficiencyTest.organizationId, member.organizationId),
      ];
      if (query) {
        conditions.push(
          or(
            ilike(proficiencyTest.ptRound, `%${query}%`),
            ilike(proficiencyTest.provider, `%${query}%`),
            ilike(proficiencyTest.scopePart, `%${query}%`),
          )!,
        );
      }
      if (status) {
        conditions.push(eq(proficiencyTest.overallStatus, status));
      }
      if (activityType) {
        conditions.push(eq(proficiencyTest.activityType, activityType));
      }
      if (scopePart) {
        conditions.push(eq(proficiencyTest.scopePart, scopePart));
      }
      const whereCondition = and(...conditions);

      const [countResult] = await db
        .select({ total: count() })
        .from(proficiencyTest)
        .where(whereCondition);

      const rounds = await db
        .select({
          id: proficiencyTest.id,
          activityType: proficiencyTest.activityType,
          provider: proficiencyTest.provider,
          providerAccreditation: proficiencyTest.providerAccreditation,
          ptRound: proficiencyTest.ptRound,
          scopePart: proficiencyTest.scopePart,
          metrologyKind: proficiencyTest.metrologyKind,
          standardId: proficiencyTest.standardId,
          standardName: referenceStandard.name,
          registrationDate: proficiencyTest.registrationDate,
          participationDate: proficiencyTest.participationDate,
          resultReportedAt: proficiencyTest.resultReportedAt,
          overallStatus: proficiencyTest.overallStatus,
          capaId: proficiencyTest.capaId,
          createdAt: proficiencyTest.createdAt,
          updatedAt: proficiencyTest.updatedAt,
        })
        .from(proficiencyTest)
        .leftJoin(
          referenceStandard,
          eq(proficiencyTest.standardId, referenceStandard.id),
        )
        .where(whereCondition)
        .orderBy(desc(proficiencyTest.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        data: rounds,
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
  // GET /summary - Status counts + participation-plan compliance
  // =========================================================================
  .get(
    "/summary",
    ...withLabPermission({ proficiency_test: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const orgScope = eq(
        proficiencyTest.organizationId,
        member.organizationId,
      );

      const [rows, planItems] = await Promise.all([
        db
          .select({
            overallStatus: proficiencyTest.overallStatus,
            total: count(),
          })
          .from(proficiencyTest)
          .where(orgScope)
          .groupBy(proficiencyTest.overallStatus),
        db
          .select({
            id: ptPlanItem.id,
            nextDueAt: ptPlanItem.nextDueAt,
          })
          .from(ptPlanItem)
          .where(eq(ptPlanItem.organizationId, member.organizationId)),
      ]);

      const byStatus: Record<string, number> = {};
      for (const row of rows) {
        byStatus[row.overallStatus] = row.total;
      }
      const now = new Date();
      const soon = addMonths(now, 3);
      let planOverdue = 0;
      let planDueSoon = 0;
      for (const item of planItems) {
        if (!item.nextDueAt) continue;
        if (item.nextDueAt < now) planOverdue += 1;
        else if (item.nextDueAt <= soon) planDueSoon += 1;
      }

      return c.json({
        total: rows.reduce((acc, row) => acc + row.total, 0),
        pending: byStatus["pending"] ?? 0,
        satisfactory: byStatus["satisfactory"] ?? 0,
        questionable: byStatus["questionable"] ?? 0,
        unsatisfactory: byStatus["unsatisfactory"] ?? 0,
        planItems: planItems.length,
        planOverdue,
        planDueSoon,
      });
    },
  )

  // =========================================================================
  // GET /plan - Participation plan (NIT-DICLA-026 §9.4)
  // =========================================================================
  .get(
    "/plan",
    ...withLabPermission({ proficiency_test: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const items = await db
        .select({
          id: ptPlanItem.id,
          scopePart: ptPlanItem.scopePart,
          riskJustification: ptPlanItem.riskJustification,
          frequencyMonths: ptPlanItem.frequencyMonths,
          lastSatisfactoryAt: ptPlanItem.lastSatisfactoryAt,
          nextDueAt: ptPlanItem.nextDueAt,
          createdAt: ptPlanItem.createdAt,
          updatedAt: ptPlanItem.updatedAt,
        })
        .from(ptPlanItem)
        .where(eq(ptPlanItem.organizationId, member.organizationId))
        .orderBy(asc(ptPlanItem.nextDueAt), asc(ptPlanItem.scopePart));
      return c.json({ data: items });
    },
  )

  // =========================================================================
  // POST /plan - Create a plan item
  // =========================================================================
  .post(
    "/plan",
    ...withLabPermission({ proficiency_test: ["create"] }),
    zValidator("json", CreatePtPlanItemSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const lastSatisfactoryAt = input.lastSatisfactoryAt
        ? new Date(input.lastSatisfactoryAt)
        : null;
      const [created] = await db
        .insert(ptPlanItem)
        .values({
          organizationId: member.organizationId,
          unitId: input.unitId ?? null,
          scopePart: input.scopePart,
          riskJustification: input.riskJustification ?? null,
          frequencyMonths: input.frequencyMonths,
          lastSatisfactoryAt,
          nextDueAt: lastSatisfactoryAt
            ? addMonths(lastSatisfactoryAt, input.frequencyMonths)
            : new Date(),
          createdBy: session.user.id,
        })
        .returning();

      return c.json(created, 201);
    },
  )

  // =========================================================================
  // PUT /plan/:id - Update a plan item
  // =========================================================================
  .put(
    "/plan/:id",
    ...withLabPermission({ proficiency_test: ["update"] }),
    zValidator("json", UpdatePtPlanItemSchema),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(ptPlanItem)
        .where(
          and(
            eq(ptPlanItem.id, id),
            eq(ptPlanItem.organizationId, member.organizationId),
          ),
        )
        .limit(1);
      if (!existing) {
        return c.json({ error: "Item do plano não encontrado" }, 404);
      }

      const frequencyMonths = input.frequencyMonths ?? existing.frequencyMonths;
      const lastSatisfactoryAt =
        input.lastSatisfactoryAt === undefined
          ? existing.lastSatisfactoryAt
          : input.lastSatisfactoryAt === null
            ? null
            : new Date(input.lastSatisfactoryAt);

      const [updated] = await db
        .update(ptPlanItem)
        .set({
          scopePart: input.scopePart ?? existing.scopePart,
          riskJustification:
            input.riskJustification === undefined
              ? existing.riskJustification
              : input.riskJustification,
          frequencyMonths,
          lastSatisfactoryAt,
          nextDueAt: lastSatisfactoryAt
            ? addMonths(lastSatisfactoryAt, frequencyMonths)
            : existing.nextDueAt,
        })
        .where(
          and(
            eq(ptPlanItem.id, id),
            eq(ptPlanItem.organizationId, member.organizationId),
          ),
        )
        .returning();

      return c.json(updated);
    },
  )

  // =========================================================================
  // DELETE /plan/:id - Remove a plan item
  // =========================================================================
  .delete(
    "/plan/:id",
    ...withLabPermission({ proficiency_test: ["delete"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const deleted = await db
        .delete(ptPlanItem)
        .where(
          and(
            eq(ptPlanItem.id, id),
            eq(ptPlanItem.organizationId, member.organizationId),
          ),
        )
        .returning();
      if (deleted.length === 0) {
        return c.json({ error: "Item do plano não encontrado" }, 404);
      }
      return c.json({ message: "Item removido" });
    },
  )

  // =========================================================================
  // GET /:id - PT round detail
  // =========================================================================
  .get(
    "/:id",
    ...withLabPermission({ proficiency_test: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [round] = await db
        .select({
          id: proficiencyTest.id,
          activityType: proficiencyTest.activityType,
          provider: proficiencyTest.provider,
          providerAccreditation: proficiencyTest.providerAccreditation,
          ptRound: proficiencyTest.ptRound,
          scopePart: proficiencyTest.scopePart,
          metrologyKind: proficiencyTest.metrologyKind,
          standardId: proficiencyTest.standardId,
          standardName: referenceStandard.name,
          registrationDate: proficiencyTest.registrationDate,
          participationDate: proficiencyTest.participationDate,
          resultReportedAt: proficiencyTest.resultReportedAt,
          results: proficiencyTest.results,
          overallStatus: proficiencyTest.overallStatus,
          capaId: proficiencyTest.capaId,
          notes: proficiencyTest.notes,
          createdBy: proficiencyTest.createdBy,
          createdByName: user.name,
          createdAt: proficiencyTest.createdAt,
          updatedAt: proficiencyTest.updatedAt,
        })
        .from(proficiencyTest)
        .leftJoin(
          referenceStandard,
          eq(proficiencyTest.standardId, referenceStandard.id),
        )
        .leftJoin(user, eq(proficiencyTest.createdBy, user.id))
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!round) {
        return c.json({ error: "Ensaio de proficiência não encontrado" }, 404);
      }
      return c.json(round);
    },
  )

  // =========================================================================
  // GET /:id/audit-log
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ proficiency_test: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      // Tenant check before exposing the (FK-less) audit trail
      const [round] = await db
        .select({ id: proficiencyTest.id })
        .from(proficiencyTest)
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .limit(1);
      if (!round) {
        return c.json({ error: "Ensaio de proficiência não encontrado" }, 404);
      }

      const entries = await db
        .select({
          id: proficiencyTestAuditLog.id,
          action: proficiencyTestAuditLog.action,
          changes: proficiencyTestAuditLog.changes,
          performedBy: proficiencyTestAuditLog.performedBy,
          performedByName: user.name,
          performedAt: proficiencyTestAuditLog.performedAt,
          reason: proficiencyTestAuditLog.reason,
        })
        .from(proficiencyTestAuditLog)
        .leftJoin(user, eq(proficiencyTestAuditLog.performedBy, user.id))
        .where(eq(proficiencyTestAuditLog.proficiencyTestId, id))
        .orderBy(desc(proficiencyTestAuditLog.performedAt));

      return c.json({ data: entries });
    },
  )

  // =========================================================================
  // POST / - Register a PT round
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ proficiency_test: ["create"] }),
    zValidator("json", CreateProficiencyTestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      if (input.standardId) {
        const [standard] = await db
          .select({ id: referenceStandard.id })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.id, input.standardId),
              eq(referenceStandard.organizationId, member.organizationId),
            ),
          )
          .limit(1);
        if (!standard) {
          return c.json({ error: "Padrão de referência não encontrado" }, 404);
        }
      }

      const [created] = await db
        .insert(proficiencyTest)
        .values({
          organizationId: member.organizationId,
          unitId: input.unitId ?? null,
          activityType: input.activityType,
          provider: input.provider,
          providerAccreditation: input.providerAccreditation ?? null,
          ptRound: input.ptRound,
          scopePart: input.scopePart,
          metrologyKind: input.metrologyKind ?? null,
          standardId: input.standardId ?? null,
          registrationDate: input.registrationDate
            ? new Date(input.registrationDate)
            : null,
          participationDate: input.participationDate
            ? new Date(input.participationDate)
            : null,
          overallStatus: "pending",
          notes: input.notes ?? null,
          createdBy: session.user.id,
        })
        .returning();

      if (!created) {
        return c.json({ error: "Falha ao registrar ensaio" }, 500);
      }

      await db.insert(proficiencyTestAuditLog).values({
        proficiencyTestId: created.id,
        action: "create",
        changes: { initial: input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(created, 201);
    },
  )

  // =========================================================================
  // PUT /:id - Update a PT round (metadata only; results via /:id/results)
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ proficiency_test: ["update"] }),
    zValidator("json", UpdateProficiencyTestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(proficiencyTest)
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .limit(1);
      if (!existing) {
        return c.json({ error: "Ensaio de proficiência não encontrado" }, 404);
      }

      if (input.standardId) {
        const [standard] = await db
          .select({ id: referenceStandard.id })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.id, input.standardId),
              eq(referenceStandard.organizationId, member.organizationId),
            ),
          )
          .limit(1);
        if (!standard) {
          return c.json({ error: "Padrão de referência não encontrado" }, 404);
        }
      }

      const [updated] = await db
        .update(proficiencyTest)
        .set({
          activityType: input.activityType ?? existing.activityType,
          provider: input.provider ?? existing.provider,
          providerAccreditation:
            input.providerAccreditation === undefined
              ? existing.providerAccreditation
              : input.providerAccreditation,
          ptRound: input.ptRound ?? existing.ptRound,
          scopePart: input.scopePart ?? existing.scopePart,
          metrologyKind:
            input.metrologyKind === undefined
              ? existing.metrologyKind
              : input.metrologyKind,
          standardId:
            input.standardId === undefined
              ? existing.standardId
              : input.standardId,
          registrationDate:
            input.registrationDate === undefined
              ? existing.registrationDate
              : input.registrationDate === null
                ? null
                : new Date(input.registrationDate),
          participationDate:
            input.participationDate === undefined
              ? existing.participationDate
              : input.participationDate === null
                ? null
                : new Date(input.participationDate),
          notes: input.notes === undefined ? existing.notes : input.notes,
        })
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .returning();

      await db.insert(proficiencyTestAuditLog).values({
        proficiencyTestId: id,
        action: "update",
        changes: { input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/results - Enter the provider's final report.
  // Scores + verdicts are computed server-side (ISO 13528); unsatisfactory
  // results auto-open a CAPA (§7.7.3) and a satisfactory round advances the
  // participation-plan clock for its scope part.
  // =========================================================================
  .post(
    "/:id/results",
    ...withLabPermission({ proficiency_test: ["record_results"] }),
    zValidator("json", RecordPtResultsSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(proficiencyTest)
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .limit(1);
      if (!existing) {
        return c.json({ error: "Ensaio de proficiência não encontrado" }, 404);
      }

      const results = input.results.map(computeResultPoint);
      const overallStatus = overallStatusFromResults(results);
      const resultReportedAt = new Date(input.resultReportedAt);

      // §7.7.3 auto-escalation — guarded against double-escalation like the
      // NC escalate-to-capa flow.
      let capaId = existing.capaId;
      if (overallStatus === "unsatisfactory" && !existing.capaId) {
        const failedPoints = results
          .filter((r) => r.verdict === "unsatisfactory")
          .map(
            (r) =>
              `${r.label}: ${r.scoreType} = ${r.score == null ? "n/d" : r.score.toFixed(2)}`,
          )
          .join("; ");
        const newCapa = await createCorrectiveActionRecord({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          source: "proficiency_test",
          sourceReference: `${existing.ptRound} (${existing.provider})`,
          title: `Resultado insatisfatório no EP ${existing.ptRound}`,
          description: `Ensaio de proficiência "${existing.ptRound}" (${existing.provider}) com resultado insatisfatório no escopo "${existing.scopePart}". Pontos reprovados: ${failedPoints}.`,
          detectionDate: resultReportedAt,
          severity: "major",
          category: "method",
          ipAddress: c.req.header("x-forwarded-for") || null,
        });
        capaId = newCapa.id;
      }

      const [updated] = await db
        .update(proficiencyTest)
        .set({
          results,
          overallStatus,
          resultReportedAt,
          capaId,
        })
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .returning();

      await db.insert(proficiencyTestAuditLog).values({
        proficiencyTestId: id,
        action: capaId !== existing.capaId ? "escalate" : "record_results",
        changes: {
          overallStatus: { old: existing.overallStatus, new: overallStatus },
          points: results.length,
          ...(capaId !== existing.capaId ? { capaId } : {}),
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Advance the 4-year compliance clock for this scope part
      if (overallStatus === "satisfactory") {
        const [planItem] = await db
          .select()
          .from(ptPlanItem)
          .where(
            and(
              eq(ptPlanItem.organizationId, member.organizationId),
              eq(ptPlanItem.scopePart, existing.scopePart),
            ),
          )
          .limit(1);
        if (
          planItem &&
          (!planItem.lastSatisfactoryAt ||
            planItem.lastSatisfactoryAt < resultReportedAt)
        ) {
          await db
            .update(ptPlanItem)
            .set({
              lastSatisfactoryAt: resultReportedAt,
              nextDueAt: addMonths(resultReportedAt, planItem.frequencyMonths),
            })
            .where(eq(ptPlanItem.id, planItem.id));
        }
      }

      return c.json(updated);
    },
  )

  // =========================================================================
  // DELETE /:id - Remove a PT round
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ proficiency_test: ["delete"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const deleted = await db
        .delete(proficiencyTest)
        .where(
          and(
            eq(proficiencyTest.id, id),
            eq(proficiencyTest.organizationId, member.organizationId),
          ),
        )
        .returning();
      if (deleted.length === 0) {
        return c.json({ error: "Ensaio de proficiência não encontrado" }, 404);
      }

      // Audit rows are FK-less on purpose — the trail survives the delete.
      await db.insert(proficiencyTestAuditLog).values({
        proficiencyTestId: id,
        action: "delete",
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      return c.json({ message: "Ensaio removido" });
    },
  );
