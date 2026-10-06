import { db } from "@calibra-facil/db";
import { nonConformance, referenceStandard } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField } from "./api";
import type { SeedContext } from "./context";
import type { SeedJob } from "./jobs";

const DAY_MS = 86_400_000;

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/**
 * ISO/IEC 17025 clauses 7.7 and 8.7: non-conformances, corrective actions,
 * proficiency testing and the control chart of a check standard. Two NCs and one
 * CAPA are left open (the dashboard's quality row); the rest is closed history.
 */
export async function seedQuality(
  ctx: SeedContext,
  jobs: readonly SeedJob[],
): Promise<void> {
  const rng = ctx.rng.fork("quality");
  // Re-run guard: quality records have no natural key, so one count decides.
  const [existing] = await db
    .select({ id: nonConformance.id })
    .from(nonConformance)
    .where(eq(nonConformance.organizationId, LAB_ID))
    .limit(1);
  if (existing) {
    ctx.log("  quality: already seeded");
    return;
  }

  const approved = jobs.filter((job) => job.planned.final === "APPROVED");
  const rejected = jobs.filter((job) => job.planned.final === "REJECTED");
  const recentApproved = approved[approved.length - 4];
  const midApproved = approved[Math.floor(approved.length / 2)];
  const rejectedJob = rejected[rejected.length - 1];

  // Open NC awaiting a disposition.
  await ctx.api.call("technician", "POST", "/api/nc", {
    type: "equipment",
    description:
      "Verificação intermediária do jogo de pesos E2 apresentou desvio acima do limite de alerta no peso de 100 g; padrão mantido em uso restrito até a análise.",
    detectedAt: daysAgo(ctx.now, 3),
    jobId: recentApproved?.jobId,
  });

  // Open NC under review, with a disposition already set.
  const underReview = await ctx.api.call("technician", "POST", "/api/nc", {
    type: "work",
    description:
      "Leituras de repetibilidade fora do padrão do instrumento durante o ensaio; calibração rejeitada na revisão técnica e a repetir.",
    detectedAt: daysAgo(ctx.now, 6),
    jobId: rejectedJob?.jobId,
  });
  await ctx.api.call(
    "technician",
    "PUT",
    `/api/nc/${numberField(underReview, "id")}/disposition`,
    { disposition: "rework" },
  );

  // Resolved documentation NC.
  const documentation = await ctx.api.call("reviewer", "POST", "/api/nc", {
    type: "documentation",
    description:
      "Certificado do padrão de temperatura arquivado sem o anexo de rastreabilidade; documento localizado e incluído no registro do padrão.",
    detectedAt: daysAgo(ctx.now, 41),
  });
  await ctx.api.call(
    "reviewer",
    "PUT",
    `/api/nc/${numberField(documentation, "id")}/disposition`,
    { disposition: "rework" },
  );
  await ctx.api.call(
    "reviewer",
    "POST",
    `/api/nc/${numberField(documentation, "id")}/resolve`,
    {
      correctionTaken:
        "Anexo de rastreabilidade incluído e procedimento de recebimento de padrões revisado.",
    },
  );

  // An NC that became the lab's one open corrective action.
  const escalated = await ctx.api.call("technician", "POST", "/api/nc", {
    type: "equipment",
    description:
      "Termohigrômetro da sala de calibração registrou umidade fora do limite durante duas calibrações consecutivas.",
    detectedAt: daysAgo(ctx.now, 18),
    jobId: midApproved?.jobId,
  });
  const escalatedId = numberField(escalated, "id");
  await ctx.api.call("reviewer", "PUT", `/api/nc/${escalatedId}/disposition`, {
    disposition: "use_as_is",
    justification:
      "Resultados avaliados e mantidos: a variação de umidade não afeta a incerteza declarada para este método.",
  });
  await ctx.api.call(
    "reviewer",
    "POST",
    `/api/nc/${escalatedId}/escalate-to-capa`,
    {
      rootCauseAnalysis:
        "Desumidificador da sala com filtro saturado e ajuste de histerese incorreto.",
      actionPlan:
        "Substituir o filtro, ajustar a histerese e incluir verificação semanal no checklist da sala.",
      dueDate: new Date(ctx.now.getTime() + 12 * DAY_MS).toISOString(),
      responsibleId: "demo-reviewer",
    },
  );
  await ctx.api.call("reviewer", "POST", `/api/nc/${escalatedId}/resolve`, {
    correctionTaken:
      "Calibrações afetadas reavaliadas; condições ambientais restabelecidas dentro do limite.",
  });

  // A corrective action carried all the way to closure.
  const closed = await ctx.api.call("reviewer", "POST", "/api/capa", {
    title:
      "Atualizar o procedimento de verificação intermediária dos pesos padrão",
    description:
      "A auditoria interna apontou que a periodicidade da verificação intermediária não estava definida por classe de peso.",
    source: "internal_audit",
    sourceReference: "Auditoria interna 2026/1",
    detectionDate: daysAgo(ctx.now, 75),
    type: "preventive",
    severity: "minor",
    category: "procedure",
    actionPlan:
      "Definir a periodicidade por classe (E2 mensal, F1 trimestral) e registrar em formulário próprio.",
    responsibleId: "demo-reviewer",
    dueDate: daysAgo(ctx.now, 30),
    rootCauseAnalysis:
      "Procedimento antigo não distinguia classes de exatidão.",
    rootCauseAnalysisMethod: "5_whys",
  });
  const closedId = numberField(closed, "id");
  await ctx.api.call("reviewer", "POST", `/api/capa/${closedId}/implement`, {
    implementationEvidence:
      "Procedimento PO-QUA-012 revisado e formulário FR-QUA-031 emitido e treinado.",
  });
  await ctx.api.call("owner", "POST", `/api/capa/${closedId}/verify`, {
    effectivenessConfirmed: true,
    verificationNotes:
      "Três ciclos de verificação intermediária executados conforme a nova periodicidade.",
  });
  await ctx.api.call("owner", "POST", `/api/capa/${closedId}/close`, {});

  // Proficiency testing: a satisfactory round and the participation plan.
  const pt = await ctx.api.call("reviewer", "POST", "/api/proficiency-tests", {
    activityType: "proficiency_test",
    provider: "Provedor de Ensaios de Proficiência Exemplo",
    ptRound: "EP-MASSA-2026/1",
    scopePart: "Calibração de instrumentos de pesagem (massa)",
    metrologyKind: "mass",
    registrationDate: daysAgo(ctx.now, 120),
    participationDate: daysAgo(ctx.now, 95),
  });
  await ctx.api.call(
    "reviewer",
    "POST",
    `/api/proficiency-tests/${numberField(pt, "id")}/results`,
    {
      resultReportedAt: daysAgo(ctx.now, 52),
      results: [
        {
          label: "Peso 10 g",
          unit: "g",
          labValue: 10.00002,
          labUncertainty: 0.00006,
          refValue: 10.000015,
          refUncertainty: 0.00003,
          scoreType: "en",
        },
        {
          label: "Peso 200 g",
          unit: "g",
          labValue: 200.00031,
          labUncertainty: 0.0003,
          refValue: 200.00025,
          refUncertainty: 0.00015,
          scoreType: "en",
        },
        {
          label: "Peso 1 kg",
          unit: "g",
          labValue: 1000.0011,
          labUncertainty: 0.0016,
          refValue: 1000.0006,
          refUncertainty: 0.0008,
          scoreType: "en",
        },
      ],
    },
  );
  await ctx.api.call("reviewer", "POST", "/api/proficiency-tests/plan", {
    scopePart: "Calibração de instrumentos de força",
    riskJustification:
      "Menor volume de calibrações; ciclo máximo de participação adotado.",
    frequencyMonths: 48,
    lastSatisfactoryAt: daysAgo(ctx.now, 300),
  });

  // Control chart of a check standard, ending in a signal.
  const [weights] = await db
    .select({ id: referenceStandard.id })
    .from(referenceStandard)
    .where(
      and(
        eq(referenceStandard.organizationId, LAB_ID),
        eq(referenceStandard.serialNumber, "E2-48213"),
      ),
    )
    .limit(1);
  if (weights) {
    const parameter = "Peso 100 g E2 (verificação intermediária)";
    const readings: number[] = [];
    for (let i = 0; i < 22; i += 1)
      readings.push(rng.normal(100.00012, 0.00005));
    // The last readings drift upward: a trending signal for the quality manager.
    readings.push(100.00042, 100.00051);
    for (const [index, value] of readings.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.api.call("technician", "POST", "/api/spc/readings", {
        standardId: weights.id,
        parameter,
        value: Number(value.toFixed(5)),
        uncertainty: 0.00005,
        measuredAt: daysAgo(ctx.now, (readings.length - index) * 4),
      });
    }
    const chart = await ctx.api.call("technician", "POST", "/api/spc/charts", {
      standardId: weights.id,
      parameter,
      chartType: "i_mr",
      params: { baselineWindow: 20 },
    });
    await ctx.api.call(
      "technician",
      "POST",
      `/api/spc/charts/${numberField(chart, "id")}/recalculate`,
      {},
    );
  }
  ctx.log(
    "  quality: 4 NCs (2 open), 2 CAPAs (1 open), 1 PT round, 1 plan item, 1 control chart",
  );
}
