/**
 * entity-labels-contract.int.spec.ts: the cloud half of the entity-label
 * endpoint definitions (`packages/contracts/src/endpoints/entity-labels.ts`).
 * The NC, CAPA and competence label routes are called for real (real handlers,
 * real middleware, real Postgres) and their bodies are parsed with the response
 * schemas of the definitions. `mount` also checks each body in the integration
 * tier (`checkEndpointResponses`).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { entityLabelEndpoints } from "@calibra-facil/contracts";
import {
  correctiveAction,
  nonConformance,
  personnelCompetence,
} from "@calibra-facil/db/schema";
import { capaRouter } from "./capa";
import { competencesRouter } from "./competences";
import { nonConformancesRouter } from "./non-conformances";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { withStatusRepair } from "../../test/integration/state-fixtures";

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

async function seedRecords() {
  const org = await seedOrg({ orgId: "org-labels-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });

  const [nc] = await withStatusRepair((tx) =>
    tx
      .insert(nonConformance)
      .values({
        ncNumber: "NC-2026-9001",
        organizationId: org.orgId,
        type: "work",
        description: "Medição fora de tolerância",
        detectedBy: org.userId,
        detectedAt: new Date("2026-01-10T10:00:00.000Z"),
        status: "open",
        createdBy: org.userId,
      })
      .returning({ id: nonConformance.id }),
  );
  const [capa] = await withStatusRepair((tx) =>
    tx
      .insert(correctiveAction)
      .values({
        capaNumber: "CAPA-2026-9001",
        organizationId: org.orgId,
        source: "nc_detection",
        title: "CAPA de contrato",
        description: "Inserida diretamente.",
        type: "corrective",
        severity: "minor",
        category: "procedure",
        status: "OPEN",
        createdBy: org.userId,
      })
      .returning({ id: correctiveAction.id }),
  );
  const [competence] = await withStatusRepair((tx) =>
    tx
      .insert(personnelCompetence)
      .values({
        organizationId: org.orgId,
        userId: org.userId,
        requestedBy: org.userId,
        createdBy: org.userId,
        scopeDescription: "Calibração de manômetros",
        status: "REQUESTED",
      })
      .returning({ id: personnelCompetence.id }),
  );
  if (!nc || !capa || !competence) throw new Error("seed failed");
  return { org, ncId: nc.id, capaId: capa.id, competenceId: competence.id };
}

describe("entity-label endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("answer the record's id and label", async () => {
    const { org, ncId, capaId, competenceId } = await seedRecords();

    const ncLabel = await parsedBody(
      await nonConformancesRouter.request(`/${ncId}/label`),
      entityLabelEndpoints.getNonConformance.response,
    );
    expect(ncLabel).toMatchObject({ id: ncId, label: "NC-2026-9001" });

    const capaLabel = await parsedBody(
      await capaRouter.request(`/${capaId}/label`),
      entityLabelEndpoints.getCapa.response,
    );
    expect(capaLabel).toMatchObject({ id: capaId, label: "CAPA-2026-9001" });

    const competenceLabel = await parsedBody(
      await competencesRouter.request(`/${competenceId}/label`),
      entityLabelEndpoints.getCompetence.response,
    );
    expect(competenceLabel).toMatchObject({
      id: competenceId,
      label: `User ${org.userId}`,
    });
  });

  it("a missing record is a 404 (the client turns it into a null label)", async () => {
    await seedRecords();

    expect((await nonConformancesRouter.request("/999999/label")).status).toBe(
      404,
    );
    expect((await capaRouter.request("/999999/label")).status).toBe(404);
    expect((await competencesRouter.request("/999999/label")).status).toBe(404);
  });
});
