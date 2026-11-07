import { createRouter } from "../../../server/router";
import { spcEndpoints } from "@calibra-facil/contracts";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  checkStandardReading,
  controlChart,
  referenceStandard,
  user,
  type SpcChartParams,
  type SpcEvaluation,
} from "@calibra-facil/db/schema";
import { evaluateChart } from "@calibra-facil/interval-analysis";
import {
  withLabPermission,
  type AuthVariables,
  type MemberData,
} from "../../../middleware/permission";
import { createCorrectiveActionRecord } from "../corrective-actions";
import { calibrationJobBelongsToOrganization } from "../../../lib/tenant-refs";
import { buildUnitScopeCondition } from "../../../lib/units";
import { resolveAccessibleUnitContext } from "../../org";
import { eq, and, asc, desc, count } from "drizzle-orm";
import { SPC_MACHINE } from "@calibra-facil/schemas/machines";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

/**
 * SPC Router - ISO/IEC 17025 §7.7.1 (issue #60 Phase 1)
 *
 * Check/working-standard readings + per-standard control charts. The pure
 * evaluation engine lives in @calibra-facil/interval-analysis (shared with
 * the interval-optimization drift work, #423). Signals escalate to CAPA.
 */

async function loadChartScoped(
  id: number,
  organizationId: string,
  executor: Pick<OrgExecutor, "select">,
) {
  const [chart] = await executor
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

/** The laboratory's chart, or a 404. */
async function requireChart(
  id: number,
  organizationId: string,
  executor: Pick<OrgExecutor, "select">,
) {
  const chart = await loadChartScoped(id, organizationId, executor);
  if (!chart) {
    throw notFound(
      "control_chart_not_found",
      "Carta de controle não encontrada",
    );
  }
  return chart;
}

/** A reference standard the caller can see (the unit scope applies), or a 404. */
async function requireVisibleStandard(
  standardId: number,
  member: MemberData,
  executor: Pick<OrgExecutor, "select">,
) {
  const [standard] = await executor
    .select({ id: referenceStandard.id })
    .from(referenceStandard)
    .where(
      and(
        eq(referenceStandard.id, standardId),
        eq(referenceStandard.organizationId, member.organizationId),
        // A standard outside the caller's units is not visible to them
        // (the `spc:create` unit elevation relies on this, see
        // UNIT_ELEVATED_ACTIONS in middleware/permission.ts).
        buildUnitScopeCondition(referenceStandard.unitId, member),
      ),
    )
    .limit(1);
  if (!standard) {
    throw notFound("standard_not_found", "Padrão de referência não encontrado");
  }
}

/**
 * Re-evaluates one chart from its stored readings and persists the result.
 * Shared by the manual recalculate endpoint, reading ingestion and the
 * nightly cron sweep.
 */
async function recomputeControlChart(
  chart: typeof controlChart.$inferSelect,
  executor: Pick<OrgExecutor, "select" | "update">,
): Promise<SpcEvaluation> {
  const readings = await executor
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
    .orderBy(
      asc(checkStandardReading.measuredAt),
      asc(checkStandardReading.id),
    );

  const params: SpcChartParams = chart.params ?? {};
  const evaluation: SpcEvaluation = {
    ...evaluateChart(
      readings.map((r) => r.value),
      chart.chartType,
      params,
    ),
    evaluatedAt: new Date().toISOString(),
  };

  await executor
    .update(controlChart)
    .set({
      status: SPC_MACHINE.requireTransition(
        chart.status,
        "recompute",
        evaluation.status,
      ),
      lastEvaluation: evaluation,
      lastEvaluatedAt: new Date(),
    })
    .where(eq(controlChart.id, chart.id));

  return evaluation;
}

const PREFIX = "/api/spc";

export const spcRouter = createRouter<{ Variables: AuthVariables }>();

// =========================================================================
// GET /charts - List control charts (org-wide overview)
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.listCharts,
  withLabPermission({ spc: ["read"] }),
  async (c, { query: { standardId, status, page, limit } }) => {
    const member = c.get("member");
    const offset = (page - 1) * limit;

    const conditions = [eq(controlChart.organizationId, member.organizationId)];
    if (standardId) {
      conditions.push(eq(controlChart.standardId, standardId));
    }
    if (status) {
      conditions.push(eq(controlChart.status, status));
    }
    const whereCondition = and(...conditions);

    return await orgDb(member.organizationId).transaction(async (tx) => {
      const [countResult] = await tx
        .select({ total: count() })
        .from(controlChart)
        .where(whereCondition);

      const charts = await tx
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

      return {
        data: charts,
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
// GET /charts/:id - Chart detail incl. chronological readings
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.getChart,
  withLabPermission({ spc: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const chart = await requireChart(id, member.organizationId, tx);

      const [readings, [standard]] = await Promise.all([
        tx
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
        tx
          .select({ id: referenceStandard.id, name: referenceStandard.name })
          .from(referenceStandard)
          .where(eq(referenceStandard.id, chart.standardId))
          .limit(1),
      ]);

      return {
        ...chart,
        standardName: standard?.name ?? null,
        readings,
      };
    });
  },
);

// =========================================================================
// POST /charts - Create a control chart for a standard/parameter pair
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.createChart,
  withLabPermission({ spc: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");

    const chart = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        await requireVisibleStandard(input.standardId, member, ctx.o);

        // A body-supplied unit must be one the caller can access (throws 403
        // otherwise — identical for another tenant's unit and an unknown one).
        const chartUnitId =
          input.unitId == null
            ? null
            : resolveAccessibleUnitContext(member, input.unitId).unitId;

        const [existing] = await ctx.o
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
          throw invalid(
            "control_chart_exists",
            "Já existe uma carta para este padrão e parâmetro",
          );
        }

        const [created] = await ctx.o
          .insert(controlChart)
          .values({
            organizationId: member.organizationId,
            unitId: chartUnitId,
            standardId: input.standardId,
            parameter: input.parameter,
            chartType: input.chartType,
            params: input.params ?? null,
            createdBy: ctx.actor.userId,
          })
          .returning();

        if (!created) {
          throw new Error("Falha ao criar carta de controle");
        }

        await ctx.audit("controlChart", created.id, {
          action: "create",
          changes: { initial: input },
        });

        await recomputeControlChart(created, ctx.o);
        const refreshed = await loadChartScoped(
          created.id,
          member.organizationId,
          ctx.o,
        );
        return refreshed ?? created;
      },
    );
    return chart;
  },
);

// =========================================================================
// PUT /charts/:id - Update chart type / parameters (re-evaluates)
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.updateChart,
  withLabPermission({ spc: ["update"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const id = params.id;
    const chart = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireChart(id, member.organizationId, ctx.o);

        const [updated] = await ctx.o
          .update(controlChart)
          .set({
            chartType: input.chartType ?? existing.chartType,
            params: input.params === undefined ? existing.params : input.params,
          })
          .where(
            and(
              eq(controlChart.id, id),
              eq(controlChart.organizationId, member.organizationId),
            ),
          )
          .returning();

        await ctx.audit("controlChart", id, {
          action: "update",
          changes: { input },
        });

        if (updated) {
          await recomputeControlChart(updated, ctx.o);
        }
        const refreshed = await loadChartScoped(
          id,
          member.organizationId,
          ctx.o,
        );
        return refreshed ?? updated;
      },
    );
    if (!chart) {
      throw notFound(
        "control_chart_not_found",
        "Carta de controle não encontrada",
      );
    }
    return chart;
  },
);

// =========================================================================
// DELETE /charts/:id
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.removeChart,
  withLabPermission({ spc: ["delete"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    await withOrg(member.organizationId, requestActor(c), async (ctx) => {
      const deleted = await ctx.o
        .delete(controlChart)
        .where(
          and(
            eq(controlChart.id, id),
            eq(controlChart.organizationId, member.organizationId),
          ),
        )
        .returning();
      if (deleted.length === 0) {
        throw notFound(
          "control_chart_not_found",
          "Carta de controle não encontrada",
        );
      }
      await ctx.audit("controlChart", id, { action: "delete" });
    });
    return { message: "Carta removida" };
  },
);

// =========================================================================
// POST /charts/:id/recalculate - Re-run the SPC evaluation
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.recalculateChart,
  withLabPermission({ spc: ["recalculate"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const chart = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireChart(id, member.organizationId, ctx.o);

        const evaluation = await recomputeControlChart(existing, ctx.o);

        await ctx.audit("controlChart", id, {
          action: "recalculate",
          changes: {
            status: { old: existing.status, new: evaluation.status },
            fingerprint: evaluation.fingerprint,
          },
        });

        const refreshed = await loadChartScoped(
          id,
          member.organizationId,
          ctx.o,
        );
        return refreshed ?? existing;
      },
    );
    return chart;
  },
);

// =========================================================================
// POST /charts/:id/escalate - Open a CAPA from an SPC signal (§7.7.3)
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.escalateChart,
  withLabPermission({ spc: ["escalate"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const id = params.id;
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const chart = await requireChart(id, member.organizationId, ctx.o);
        if (chart.capaId) {
          throw invalid(
            "control_chart_already_escalated",
            "Carta já possui CAPA vinculada",
          );
        }
        if (
          chart.status === "in_control" ||
          chart.status === "insufficient_data"
        ) {
          throw invalid(
            "control_chart_in_control",
            "Carta sob controle estatístico — nada a escalar",
          );
        }

        const [standard] = await ctx.o
          .select({ name: referenceStandard.name })
          .from(referenceStandard)
          .where(eq(referenceStandard.id, chart.standardId))
          .limit(1);
        const ruleSummary = (chart.lastEvaluation?.ruleHits ?? [])
          .map((h) => h.description)
          .join("; ");

        const newCapa = await createCorrectiveActionRecord(
          {
            organizationId: member.organizationId,
            actorUserId: ctx.actor.userId,
            source: "spc_signal",
            sourceReference: `${standard?.name ?? `Padrão #${chart.standardId}`} — ${chart.parameter}`,
            title: `Sinal de controle estatístico: ${standard?.name ?? `padrão #${chart.standardId}`}`,
            description:
              input.description ??
              `Carta de controle "${chart.parameter}" do padrão ${standard?.name ?? `#${chart.standardId}`} em estado "${chart.status}". Regras violadas: ${ruleSummary || "n/d"}.`,
            detectionDate: chart.lastEvaluatedAt ?? new Date(),
            severity: chart.status === "out_of_control" ? "major" : "minor",
            category: "equipment",
            ipAddress: ctx.actor.ipAddress,
          },
          ctx.o,
        );

        await ctx.o
          .update(controlChart)
          .set({ capaId: newCapa.id })
          .where(
            and(
              eq(controlChart.id, id),
              eq(controlChart.organizationId, member.organizationId),
            ),
          );

        await ctx.audit("controlChart", id, {
          action: "escalate",
          changes: {
            capaId: { old: null, new: newCapa.id },
            capaNumber: newCapa.capaNumber,
          },
        });

        const refreshed = await loadChartScoped(
          id,
          member.organizationId,
          ctx.o,
        );
        if (!refreshed) {
          throw notFound(
            "control_chart_not_found",
            "Carta de controle não encontrada",
          );
        }
        return { chart: refreshed, capa: newCapa };
      },
    );
    return { message: "CAPA criada com sucesso", data: result };
  },
);

// =========================================================================
// GET /readings - Chronological readings for a standard (+parameter)
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.listReadings,
  withLabPermission({ spc: ["read"] }),
  async (c, { query: { standardId, parameter, limit } }) => {
    const member = c.get("member");

    const conditions = [
      eq(checkStandardReading.organizationId, member.organizationId),
      eq(checkStandardReading.standardId, standardId),
    ];
    if (parameter) {
      conditions.push(eq(checkStandardReading.parameter, parameter));
    }

    return await orgDb(member.organizationId).transaction(async (tx) => {
      const readings = await tx
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

      return { data: readings };
    });
  },
);

// =========================================================================
// POST /readings - Record a check-standard reading (re-evaluates the chart)
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.createReading,
  withLabPermission({ spc: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");

    const created = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        await requireVisibleStandard(input.standardId, member, ctx.o);

        if (
          input.sourceJobId != null &&
          !(await calibrationJobBelongsToOrganization(
            member.organizationId,
            input.sourceJobId,
            ctx.o,
          ))
        ) {
          throw notFound(
            "job_not_found",
            "Calibração de origem não encontrada",
          );
        }

        const [reading] = await ctx.o
          .insert(checkStandardReading)
          .values({
            organizationId: member.organizationId,
            standardId: input.standardId,
            parameter: input.parameter,
            value: input.value,
            uncertainty: input.uncertainty ?? null,
            measuredAt: new Date(input.measuredAt),
            sourceJobId: input.sourceJobId ?? null,
            createdBy: ctx.actor.userId,
          })
          .returning();

        // Keep the matching chart current so trends surface without waiting
        // for the nightly sweep.
        const [chart] = await ctx.o
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
          await recomputeControlChart(chart, ctx.o);
        }

        return reading;
      },
    );
    if (!created) throw new Error("Falha ao registrar leitura");
    return created;
  },
);

// =========================================================================
// DELETE /readings/:id - Remove a mistyped reading (re-evaluates the chart)
// =========================================================================
mount(
  spcRouter,
  PREFIX,
  spcEndpoints.removeReading,
  withLabPermission({ spc: ["delete"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    await withOrg(member.organizationId, requestActor(c), async (ctx) => {
      const deleted = await ctx.o
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
        throw notFound(
          "check_standard_reading_not_found",
          "Leitura não encontrada",
        );
      }

      const [chart] = await ctx.o
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
        await recomputeControlChart(chart, ctx.o);
      }
    });
    return { message: "Leitura removida" };
  },
);
