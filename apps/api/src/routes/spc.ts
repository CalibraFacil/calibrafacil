import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  checkStandardReading,
  controlChart,
  controlChartAuditLog,
  referenceStandard,
  user,
  type SpcChartParams,
  type SpcEvaluation,
} from "@calibra-facil/db/schema";
import {
  CreateCheckStandardReadingSchema,
  ListCheckStandardReadingsQuerySchema,
  CreateControlChartSchema,
  UpdateControlChartSchema,
  ListControlChartsQuerySchema,
  EscalateControlChartSchema,
} from "@calibra-facil/schemas";
import { evaluateChart } from "@calibra-facil/interval-analysis";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { createCorrectiveActionRecord } from "../lib/corrective-actions";
import { eq, and, asc, desc, count } from "drizzle-orm";

/**
 * SPC Router - ISO/IEC 17025 §7.7.1 (issue #60 Phase 1)
 *
 * Check/working-standard readings + per-standard control charts. The pure
 * evaluation engine lives in @calibra-facil/interval-analysis (shared with
 * the interval-optimization drift work, #423). Signals escalate to CAPA.
 */

async function loadChartScoped(id: number, organizationId: string) {
  const [chart] = await db
    .select()
    .from(controlChart)
    .where(
      and(
        eq(controlChart.id, id),
        eq(controlChart.organizationId, organizationId),
      ),
    )
    .limit(1);
  return chart;
}

/**
 * Re-evaluates one chart from its stored readings and persists the result.
 * Shared by the manual recalculate endpoint, reading ingestion and the
 * nightly cron sweep.
 */
export async function recomputeControlChart(
  chart: typeof controlChart.$inferSelect,
): Promise<SpcEvaluation> {
  const readings = await db
    .select({
      value: checkStandardReading.value,
      measuredAt: checkStandardReading.measuredAt,
    })
    .from(checkStandardReading)
    .where(
      and(
        eq(checkStandardReading.organizationId, chart.organizationId),
        eq(checkStandardReading.standardId, chart.standardId),
        eq(checkStandardReading.parameter, chart.parameter),
      ),
    )
    .orderBy(asc(checkStandardReading.measuredAt), asc(checkStandardReading.id));

  const params: SpcChartParams = chart.params ?? {};
  const evaluation: SpcEvaluation = {
    ...evaluateChart(
      readings.map((r) => r.value),
      chart.chartType,
      params,
    ),
    evaluatedAt: new Date().toISOString(),
  };

  await db
    .update(controlChart)
    .set({
      status: evaluation.status,
      lastEvaluation: evaluation,
      lastEvaluatedAt: new Date(),
    })
    .where(eq(controlChart.id, chart.id));

  return evaluation;
}

export const spcRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET /charts - List control charts (org-wide overview)
  // =========================================================================
  .get(
    "/charts",
    ...withLabPermission({ spc: ["read"] }),
    zValidator("query", ListControlChartsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { standardId, status, page, limit } = c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(controlChart.organizationId, member.organizationId),
      ];
      if (standardId) {
        conditions.push(eq(controlChart.standardId, standardId));
      }
      if (status) {
        conditions.push(eq(controlChart.status, status));
      }
      const whereCondition = and(...conditions);

      const [countResult] = await db
        .select({ total: count() })
        .from(controlChart)
        .where(whereCondition);

      const charts = await db
        .select({
          id: controlChart.id,
          standardId: controlChart.standardId,
          standardName: referenceStandard.name,
          parameter: controlChart.parameter,
          chartType: controlChart.chartType,
          params: controlChart.params,
          status: controlChart.status,
          lastEvaluation: controlChart.lastEvaluation,
          lastEvaluatedAt: controlChart.lastEvaluatedAt,
          ncId: controlChart.ncId,
          capaId: controlChart.capaId,
          createdAt: controlChart.createdAt,
          updatedAt: controlChart.updatedAt,
        })
        .from(controlChart)
        .leftJoin(
          referenceStandard,
          eq(controlChart.standardId, referenceStandard.id),
        )
        .where(whereCondition)
        .orderBy(desc(controlChart.updatedAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        data: charts,
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
  // GET /charts/:id - Chart detail incl. chronological readings
  // =========================================================================
  .get(
    "/charts/:id",
    ...withLabPermission({ spc: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const chart = await loadChartScoped(id, member.organizationId);
      if (!chart) {
        return c.json({ error: "Carta de controle não encontrada" }, 404);
      }

      const [readings, [standard]] = await Promise.all([
        db
          .select({
            id: checkStandardReading.id,
            value: checkStandardReading.value,
            uncertainty: checkStandardReading.uncertainty,
            measuredAt: checkStandardReading.measuredAt,
            sourceJobId: checkStandardReading.sourceJobId,
            createdBy: checkStandardReading.createdBy,
          })
          .from(checkStandardReading)
          .where(
            and(
              eq(checkStandardReading.organizationId, member.organizationId),
              eq(checkStandardReading.standardId, chart.standardId),
              eq(checkStandardReading.parameter, chart.parameter),
            ),
          )
          .orderBy(
            asc(checkStandardReading.measuredAt),
            asc(checkStandardReading.id),
          ),
        db
          .select({ id: referenceStandard.id, name: referenceStandard.name })
          .from(referenceStandard)
          .where(eq(referenceStandard.id, chart.standardId))
          .limit(1),
      ]);

      return c.json({
        ...chart,
        standardName: standard?.name ?? null,
        readings,
      });
    },
  )

  // =========================================================================
  // POST /charts - Create a control chart for a standard/parameter pair
  // =========================================================================
  .post(
    "/charts",
    ...withLabPermission({ spc: ["create"] }),
    zValidator("json", CreateControlChartSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

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

      const [existing] = await db
        .select({ id: controlChart.id })
        .from(controlChart)
        .where(
          and(
            eq(controlChart.standardId, input.standardId),
            eq(controlChart.parameter, input.parameter),
          ),
        )
        .limit(1);
      if (existing) {
        return c.json(
          { error: "Já existe uma carta para este padrão e parâmetro" },
          400,
        );
      }

      const [created] = await db
        .insert(controlChart)
        .values({
          organizationId: member.organizationId,
          unitId: input.unitId ?? null,
          standardId: input.standardId,
          parameter: input.parameter,
          chartType: input.chartType,
          params: input.params ?? null,
          createdBy: session.user.id,
        })
        .returning();

      if (!created) {
        return c.json({ error: "Falha ao criar carta de controle" }, 500);
      }

      await db.insert(controlChartAuditLog).values({
        controlChartId: created.id,
        action: "create",
        changes: { initial: input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      await recomputeControlChart(created);
      const refreshed = await loadChartScoped(
        created.id,
        member.organizationId,
      );
      return c.json(refreshed ?? created, 201);
    },
  )

  // =========================================================================
  // PUT /charts/:id - Update chart type / parameters (re-evaluates)
  // =========================================================================
  .put(
    "/charts/:id",
    ...withLabPermission({ spc: ["update"] }),
    zValidator("json", UpdateControlChartSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const chart = await loadChartScoped(id, member.organizationId);
      if (!chart) {
        return c.json({ error: "Carta de controle não encontrada" }, 404);
      }

      const [updated] = await db
        .update(controlChart)
        .set({
          chartType: input.chartType ?? chart.chartType,
          params: input.params === undefined ? chart.params : input.params,
        })
        .where(
          and(
            eq(controlChart.id, id),
            eq(controlChart.organizationId, member.organizationId),
          ),
        )
        .returning();

      await db.insert(controlChartAuditLog).values({
        controlChartId: id,
        action: "update",
        changes: { input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      if (updated) {
        await recomputeControlChart(updated);
      }
      const refreshed = await loadChartScoped(id, member.organizationId);
      return c.json(refreshed ?? updated);
    },
  )

  // =========================================================================
  // DELETE /charts/:id
  // =========================================================================
  .delete(
    "/charts/:id",
    ...withLabPermission({ spc: ["delete"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const deleted = await db
        .delete(controlChart)
        .where(
          and(
            eq(controlChart.id, id),
            eq(controlChart.organizationId, member.organizationId),
          ),
        )
        .returning();
      if (deleted.length === 0) {
        return c.json({ error: "Carta de controle não encontrada" }, 404);
      }
      await db.insert(controlChartAuditLog).values({
        controlChartId: id,
        action: "delete",
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });
      return c.json({ message: "Carta removida" });
    },
  )

  // =========================================================================
  // POST /charts/:id/recalculate - Re-run the SPC evaluation
  // =========================================================================
  .post(
    "/charts/:id/recalculate",
    ...withLabPermission({ spc: ["recalculate"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const chart = await loadChartScoped(id, member.organizationId);
      if (!chart) {
        return c.json({ error: "Carta de controle não encontrada" }, 404);
      }

      const evaluation = await recomputeControlChart(chart);

      await db.insert(controlChartAuditLog).values({
        controlChartId: id,
        action: "recalculate",
        changes: {
          status: { old: chart.status, new: evaluation.status },
          fingerprint: evaluation.fingerprint,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      const refreshed = await loadChartScoped(id, member.organizationId);
      return c.json(refreshed ?? chart);
    },
  )

  // =========================================================================
  // POST /charts/:id/escalate - Open a CAPA from an SPC signal (§7.7.3)
  // =========================================================================
  .post(
    "/charts/:id/escalate",
    ...withLabPermission({ spc: ["escalate"] }),
    zValidator("json", EscalateControlChartSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const chart = await loadChartScoped(id, member.organizationId);
      if (!chart) {
        return c.json({ error: "Carta de controle não encontrada" }, 404);
      }
      if (chart.capaId) {
        return c.json({ error: "Carta já possui CAPA vinculada" }, 400);
      }
      if (chart.status === "in_control" || chart.status === "insufficient_data") {
        return c.json(
          { error: "Carta sob controle estatístico — nada a escalar" },
          400,
        );
      }

      const [standard] = await db
        .select({ name: referenceStandard.name })
        .from(referenceStandard)
        .where(eq(referenceStandard.id, chart.standardId))
        .limit(1);
      const ruleSummary = (chart.lastEvaluation?.ruleHits ?? [])
        .map((h) => h.description)
        .join("; ");

      const newCapa = await createCorrectiveActionRecord({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        source: "spc_signal",
        sourceReference: `${standard?.name ?? `Padrão #${chart.standardId}`} — ${chart.parameter}`,
        title: `Sinal de controle estatístico: ${standard?.name ?? `padrão #${chart.standardId}`}`,
        description:
          input.description ??
          `Carta de controle "${chart.parameter}" do padrão ${standard?.name ?? `#${chart.standardId}`} em estado "${chart.status}". Regras violadas: ${ruleSummary || "n/d"}.`,
        detectionDate: chart.lastEvaluatedAt ?? new Date(),
        severity: chart.status === "out_of_control" ? "major" : "minor",
        category: "equipment",
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      await db
        .update(controlChart)
        .set({ capaId: newCapa.id })
        .where(
          and(
            eq(controlChart.id, id),
            eq(controlChart.organizationId, member.organizationId),
          ),
        );

      await db.insert(controlChartAuditLog).values({
        controlChartId: id,
        action: "escalate",
        changes: {
          capaId: { old: null, new: newCapa.id },
          capaNumber: newCapa.capaNumber,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      const refreshed = await loadChartScoped(id, member.organizationId);
      return c.json(
        { message: "CAPA criada com sucesso", data: { chart: refreshed, capa: newCapa } },
        201,
      );
    },
  )

  // =========================================================================
  // GET /readings - Chronological readings for a standard (+parameter)
  // =========================================================================
  .get(
    "/readings",
    ...withLabPermission({ spc: ["read"] }),
    zValidator("query", ListCheckStandardReadingsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { standardId, parameter, limit } = c.req.valid("query");

      const conditions = [
        eq(checkStandardReading.organizationId, member.organizationId),
        eq(checkStandardReading.standardId, standardId),
      ];
      if (parameter) {
        conditions.push(eq(checkStandardReading.parameter, parameter));
      }

      const readings = await db
        .select({
          id: checkStandardReading.id,
          standardId: checkStandardReading.standardId,
          parameter: checkStandardReading.parameter,
          value: checkStandardReading.value,
          uncertainty: checkStandardReading.uncertainty,
          measuredAt: checkStandardReading.measuredAt,
          sourceJobId: checkStandardReading.sourceJobId,
          createdBy: checkStandardReading.createdBy,
          createdByName: user.name,
          createdAt: checkStandardReading.createdAt,
        })
        .from(checkStandardReading)
        .leftJoin(user, eq(checkStandardReading.createdBy, user.id))
        .where(and(...conditions))
        .orderBy(
          asc(checkStandardReading.measuredAt),
          asc(checkStandardReading.id),
        )
        .limit(limit);

      return c.json({ data: readings });
    },
  )

  // =========================================================================
  // POST /readings - Record a check-standard reading (re-evaluates the chart)
  // =========================================================================
  .post(
    "/readings",
    ...withLabPermission({ spc: ["create"] }),
    zValidator("json", CreateCheckStandardReadingSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

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

      const [created] = await db
        .insert(checkStandardReading)
        .values({
          organizationId: member.organizationId,
          standardId: input.standardId,
          parameter: input.parameter,
          value: input.value,
          uncertainty: input.uncertainty ?? null,
          measuredAt: new Date(input.measuredAt),
          sourceJobId: input.sourceJobId ?? null,
          createdBy: session.user.id,
        })
        .returning();

      // Keep the matching chart current so trends surface without waiting
      // for the nightly sweep.
      const [chart] = await db
        .select()
        .from(controlChart)
        .where(
          and(
            eq(controlChart.organizationId, member.organizationId),
            eq(controlChart.standardId, input.standardId),
            eq(controlChart.parameter, input.parameter),
          ),
        )
        .limit(1);
      if (chart) {
        await recomputeControlChart(chart);
      }

      return c.json(created, 201);
    },
  )

  // =========================================================================
  // DELETE /readings/:id - Remove a mistyped reading (re-evaluates the chart)
  // =========================================================================
  .delete(
    "/readings/:id",
    ...withLabPermission({ spc: ["delete"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }
      const deleted = await db
        .delete(checkStandardReading)
        .where(
          and(
            eq(checkStandardReading.id, id),
            eq(checkStandardReading.organizationId, member.organizationId),
          ),
        )
        .returning();
      const removed = deleted[0];
      if (!removed) {
        return c.json({ error: "Leitura não encontrada" }, 404);
      }

      const [chart] = await db
        .select()
        .from(controlChart)
        .where(
          and(
            eq(controlChart.organizationId, member.organizationId),
            eq(controlChart.standardId, removed.standardId),
            eq(controlChart.parameter, removed.parameter),
          ),
        )
        .limit(1);
      if (chart) {
        await recomputeControlChart(chart);
      }

      return c.json({ message: "Leitura removida" });
    },
  );
