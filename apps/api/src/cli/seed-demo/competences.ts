import { db } from "@calibra-facil/db";
import { personnelCompetence } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField, type Actor } from "./api";
import type { SeedContext, SeedRefs } from "./context";

const DAY_MS = 86_400_000;

type Person = { actor: Actor; userId: string; name: string };

const PEOPLE: readonly Person[] = [
  { actor: "technician", userId: "demo-technician", name: "Tina Técnica" },
  { actor: "reviewer", userId: "demo-reviewer", name: "Rui Revisor" },
  { actor: "owner", userId: "demo-admin", name: "Ana Administradora" },
];

type CompetenceSpec = {
  assetTypeSlug: string;
  scope: string;
  trainingTitle: string;
  provider: string;
  type: "internal" | "external" | "ojt";
  hours: number;
};

const SPECS: readonly CompetenceSpec[] = [
  {
    assetTypeSlug: "balanca-digital",
    scope:
      "Calibração de instrumentos de pesagem não automáticos (EURAMET cg-18)",
    trainingTitle:
      "Calibração de balanças: erro de indicação, repetibilidade e excentricidade",
    provider: "Instituto de Metrologia Aplicada (curso externo)",
    type: "external",
    hours: 24,
  },
  {
    assetTypeSlug: "multimetro-digital",
    scope: "Calibração de multímetros digitais em tensão contínua",
    trainingTitle: "Metrologia elétrica básica: calibração de multímetros",
    provider: "Treinamento interno",
    type: "internal",
    hours: 16,
  },
  {
    assetTypeSlug: "dinamometro",
    scope: "Calibração de dinamômetros e células de carga (EURAMET cg-4)",
    trainingTitle: "Calibração de instrumentos de força",
    provider: "Treinamento em serviço (OJT)",
    type: "ojt",
    hours: 20,
  },
  {
    assetTypeSlug: "tacometro",
    scope: "Calibração de tacômetros ópticos e de contato",
    trainingTitle: "Calibração de tacômetros e medidores de rotação",
    provider: "Treinamento interno",
    type: "internal",
    hours: 8,
  },
];

/**
 * ISO/IEC 17025 §6.2: every person who runs or approves a calibration holds an
 * evaluated competence for that instrument type. They go through the real
 * workflow (request, training, evaluation); only the training dates are
 * backdated by the evaluation itself. The technician and the reviewer are
 * qualified on every type the lab calibrates, the owner on the first two.
 */
export async function seedCompetences(
  ctx: SeedContext,
  refs: SeedRefs,
): Promise<void> {
  const rng = ctx.rng.fork("competences");
  let created = 0;

  for (const person of PEOPLE) {
    const specs = person.actor === "owner" ? SPECS.slice(0, 2) : SPECS;
    for (const spec of specs) {
      const assetTypeId = refs.assetTypeIds.get(spec.assetTypeSlug);
      if (!assetTypeId)
        throw new Error(`Unknown asset type ${spec.assetTypeSlug}`);
      const [existing] = await db
        .select({ id: personnelCompetence.id })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.organizationId, LAB_ID),
            eq(personnelCompetence.userId, person.userId),
            eq(personnelCompetence.assetTypeId, assetTypeId),
          ),
        )
        .limit(1);
      if (existing) continue;

      const qualifiedDaysAgo = rng.int(120, 520);
      const qualifiedAt = new Date(
        ctx.now.getTime() - qualifiedDaysAgo * DAY_MS,
      );
      const expiresAt = new Date(qualifiedAt.getTime() + 730 * DAY_MS);
      const trainingStart = new Date(
        qualifiedAt.getTime() - rng.int(10, 30) * DAY_MS,
      );

      const competence = await ctx.api.call(
        "owner",
        "POST",
        "/api/competences",
        {
          userId: person.userId,
          assetTypeId,
          scopeDescription: spec.scope,
        },
      );
      const competenceId = numberField(competence, "id");
      const training = await ctx.api.call(
        "owner",
        "POST",
        "/api/training-records",
        {
          userId: person.userId,
          competenceId,
          title: spec.trainingTitle,
          type: spec.type,
          provider: spec.provider,
          startDate: trainingStart.toISOString(),
          endDate: qualifiedAt.toISOString(),
          hoursCompleted: spec.hours,
          score: rng.int(82, 98),
          passingScore: 70,
          passed: true,
        },
      );
      const trainingId = numberField(training, "id");
      await ctx.api.call(
        "owner",
        "POST",
        `/api/training-records/${trainingId}/complete`,
        {},
      );
      await ctx.api.call(
        "owner",
        "POST",
        `/api/competences/${competenceId}/assign-training`,
        {
          trainingRecordIds: [trainingId],
        },
      );
      await ctx.api.call(
        "owner",
        "POST",
        `/api/competences/${competenceId}/start-training`,
        {},
      );
      await ctx.api.call(
        "owner",
        "POST",
        `/api/competences/${competenceId}/complete-training`,
        {},
      );
      await ctx.api.call(
        "reviewer",
        "POST",
        `/api/competences/${competenceId}/evaluate`,
        {
          passed: true,
          notes:
            "Avaliação prática e teórica satisfatória; observada a execução de uma calibração completa.",
          qualifiedAt: qualifiedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      );
      created += 1;
    }
  }
  ctx.log(`  competences: ${created} created`);
}
