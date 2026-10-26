/**
 * unit-role-quality-records.int.spec.ts - architecture review P0-11, decision Q49.
 *
 * A unit role elevates exactly one thing on the organization-wide quality
 * records: `create`. On the REAL routes, an organization-role `member` who is a
 * `technician` of their unit creates an NC, a CAPA, a proficiency-test round, an
 * SPC chart and an SPC reading, and cannot update, record results, recalculate or
 * disposition anything.
 *
 *   REQ-Q49-3  creates succeed for the unit technician (201).
 *   REQ-Q49-4  update / disposition / record-results / recalculate are 403 and
 *              the rows are unchanged.
 *   REQ-Q49-5  the SPC create is bound to the caller's units: a standard of
 *              another unit of the same laboratory is a 404 for the chart and the
 *              reading, while an organization admin still reaches it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  controlChart,
  nonConformance,
  organizationUnit,
  proficiencyTest,
} from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import { capaRouter } from "./capa";
import { nonConformancesRouter } from "./non-conformances";
import { proficiencyTestsRouter } from "./proficiency-tests";
import { spcRouter } from "./spc";

vi.mock("@calibra-facil/notifications", () => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCEscalatedToCapa: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" } as const;

function send(
  router: {
    request: (path: string, init: RequestInit) => Response | Promise<Response>;
  },
  method: string,
  path: string,
  body: unknown,
) {
  return router.request(path, {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

const NC_BODY = {
  type: "work",
  description: "Medição fora de tolerância no ensaio de balança",
  detectedAt: "2026-01-15T10:00:00.000Z",
};

const capaBody = (responsibleId: string) => ({
  title: "Falha no procedimento de calibração",
  description:
    "Desvio identificado no processo de verificação intermediária da balança padrão.",
  source: "nc_detection",
  sourceReference: null,
  detectionDate: "2026-06-01",
  type: "corrective",
  severity: "minor",
  category: "procedure",
  actionPlan:
    "Revisar procedimento POP-CAL-007 e retreinar equipe responsável.",
  responsibleId,
  dueDate: "2026-09-01",
  rootCauseAnalysis: null,
  rootCauseAnalysisMethod: null,
  preventiveMeasures: null,
});

const PT_BODY = {
  activityType: "proficiency_test",
  provider: "Rede Metrológica RS",
  providerAccreditation: "Cgcre PEP 0002",
  ptRound: "PT-2026-01",
  scopePart: "Massa — pesos E2",
  registrationDate: "2026-02-01",
  participationDate: "2026-04-15",
};

const CHART_BODY = (standardId: number) => ({
  standardId,
  parameter: "100 g",
  chartType: "i_mr",
  params: { baselineWindow: 12 },
});

const READING_BODY = (standardId: number) => ({
  standardId,
  parameter: "100 g",
  value: 10.01,
  measuredAt: "2026-01-02T00:00:00.000Z",
});

async function seedLab() {
  const org = await seedOrg({ orgId: "org-a", role: "admin" });
  const [otherUnit] = await db
    .insert(organizationUnit)
    .values({
      organizationId: org.orgId,
      name: "Filial",
      slug: "filial",
      status: "ACTIVE",
      isDefault: false,
      createdBy: org.userId,
    })
    .returning({ id: organizationUnit.id });
  if (!otherUnit) throw new Error("unit seed failed");
  const technician = await seedExtraMember({
    orgId: org.orgId,
    userId: "user-unit-technician",
    role: "member",
    unitId: org.unitId,
    unitRole: "technician",
  });
  const ownStandard = await seedStandard({
    organizationId: org.orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  const otherStandard = await seedStandard({
    organizationId: org.orgId,
    unitId: otherUnit.id,
    createdBy: org.userId,
  });
  return { org, technician, ownStandard, otherStandard };
}

describe("a unit technician (org member) on the organization-wide quality records (Q49)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-Q49-3/4: creates an NC, a CAPA, a PT round and an SPC chart and reading, and cannot update, record results or recalculate", async () => {
    const { org, technician, ownStandard } = await seedLab();
    loginAs({ userId: technician.userId, organizationId: org.orgId });

    const nc = await send(nonConformancesRouter, "POST", "/", NC_BODY);
    expect(nc.status).toBe(201);
    const ncId: number = (await nc.json()).id;

    const capa = await send(capaRouter, "POST", "/", capaBody(org.userId));
    expect(capa.status).toBe(201);
    const capaId: number = (await capa.json()).id;

    const pt = await send(proficiencyTestsRouter, "POST", "/", PT_BODY);
    expect(pt.status).toBe(201);
    const ptId: number = (await pt.json()).id;

    const chart = await send(
      spcRouter,
      "POST",
      "/charts",
      CHART_BODY(ownStandard),
    );
    expect(chart.status).toBe(201);
    const chartId: number = (await chart.json()).id;

    const reading = await send(
      spcRouter,
      "POST",
      "/readings",
      READING_BODY(ownStandard),
    );
    expect(reading.status).toBe(201);

    // The same member cannot touch what exists.
    const refused = [
      await send(nonConformancesRouter, "PUT", `/${ncId}/disposition`, {
        disposition: "rework",
        justification: "Retrabalho do ensaio com o padrão verificado.",
      }),
      await send(capaRouter, "PUT", `/${capaId}`, { title: "Outro título" }),
      await send(capaRouter, "POST", `/${capaId}/implement`, {
        implementationEvidence: "Procedimento revisado e equipe retreinada.",
      }),
      await send(proficiencyTestsRouter, "PUT", `/${ptId}`, {
        scopePart: "Outro escopo",
      }),
      await send(proficiencyTestsRouter, "POST", `/${ptId}/results`, {
        points: [],
      }),
      await send(spcRouter, "PUT", `/charts/${chartId}`, {
        chartType: "i_mr",
        params: { baselineWindow: 20 },
      }),
      await send(spcRouter, "POST", `/charts/${chartId}/recalculate`, {}),
    ];
    expect(refused.map((res) => res.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403,
    ]);

    const [ncRow] = await db
      .select({
        status: nonConformance.status,
        disposition: nonConformance.disposition,
      })
      .from(nonConformance)
      .where(eq(nonConformance.id, ncId));
    expect(ncRow).toEqual({ status: "open", disposition: null });
    const [ptRow] = await db
      .select({ scopePart: proficiencyTest.scopePart })
      .from(proficiencyTest)
      .where(eq(proficiencyTest.id, ptId));
    expect(ptRow?.scopePart).toBe(PT_BODY.scopePart);
    const [chartRow] = await db
      .select({ params: controlChart.params })
      .from(controlChart)
      .where(eq(controlChart.id, chartId));
    expect(chartRow?.params).toMatchObject({ baselineWindow: 12 });
  });

  it("REQ-Q49-5: the SPC chart and reading of a standard of another unit are a 404 for the unit technician; an org admin reaches it", async () => {
    const { org, technician, otherStandard } = await seedLab();

    loginAs({ userId: technician.userId, organizationId: org.orgId });
    const chart = await send(
      spcRouter,
      "POST",
      "/charts",
      CHART_BODY(otherStandard),
    );
    expect(chart.status).toBe(404);
    const reading = await send(
      spcRouter,
      "POST",
      "/readings",
      READING_BODY(otherStandard),
    );
    expect(reading.status).toBe(404);

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const adminChart = await send(
      spcRouter,
      "POST",
      "/charts",
      CHART_BODY(otherStandard),
    );
    expect(adminChart.status).toBe(201);
  });
});
