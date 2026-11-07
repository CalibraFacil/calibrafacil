/**
 * competences-contract.int.spec.ts: the cloud half of the competences and
 * training-records endpoint definitions
 * (`packages/contracts/src/endpoints/{competences,training-records}.ts`). The
 * whole workflow is driven for real (real handlers, real middleware, real
 * Postgres) and every body is parsed with the response schema of its
 * definition. `mount` also checks each body with that schema in the integration
 * tier (`checkEndpointResponses`); the explicit parse names the status and the
 * drifting path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  competenceEndpoints,
  trainingRecordEndpoints,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { assetType } from "@calibra-facil/db/schema";
import { competencesRouter } from "./competences";
import { trainingRecordsRouter } from "./training-records";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedExtraMember } from "../../test/integration/tenant-refs";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

const JSON_HEADERS = { "content-type": "application/json" };

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

function send(
  router: typeof competencesRouter,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) {
  return router.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("competences and training-records endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("drives the competence workflow end to end", async () => {
    const lab = await seedOrg({ orgId: "org-comp-contract", role: "admin" });
    const technician = await seedExtraMember({
      orgId: lab.orgId,
      userId: "tech-comp-contract",
      role: "technician",
    });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Manômetro", slug: "manometro-comp", definition: [] })
      .returning({ id: assetType.id });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const created = await parsedBody(
      await send(competencesRouter, "POST", "/", {
        userId: technician.userId,
        assetTypeId: type?.id,
        scopeDescription: "Calibração de manômetros",
      }),
      competenceEndpoints.create.response,
      201,
    );
    expect(created.status).toBe("REQUESTED");
    const id = created.id;

    const training = await parsedBody(
      await send(trainingRecordsRouter, "POST", "/", {
        userId: technician.userId,
        competenceId: id,
        title: "Treinamento em manômetros",
        type: "internal",
        startDate: "2026-01-15T00:00:00.000Z",
      }),
      trainingRecordEndpoints.create.response,
      201,
    );
    expect(training.status).toBe("planned");

    const trainings = await parsedBody(
      await trainingRecordsRouter.request(
        `/?page=1&limit=20&userId=${technician.userId}`,
      ),
      trainingRecordEndpoints.list.response,
    );
    expect(trainings.data.map((row) => row.title)).toEqual([
      "Treinamento em manômetros",
    ]);

    const list = await parsedBody(
      await competencesRouter.request("/?page=1&limit=20"),
      competenceEndpoints.list.response,
    );
    expect(list.data.map((row) => row.userName)).toEqual([
      `User ${technician.userId}`,
    ]);
    await parsedBody(
      await competencesRouter.request("/matrix"),
      competenceEndpoints.matrix.response,
    );

    const assigned = await parsedBody(
      await send(competencesRouter, "POST", `/${id}/assign-training`, {
        trainingRecordIds: [training.id],
      }),
      competenceEndpoints.assignTraining.response,
    );
    expect(assigned.status).toBe("TRAINING_ASSIGNED");
    await parsedBody(
      await send(competencesRouter, "POST", `/${id}/start-training`),
      competenceEndpoints.startTraining.response,
    );
    await parsedBody(
      await send(competencesRouter, "POST", `/${id}/complete-training`),
      competenceEndpoints.completeTraining.response,
    );

    const evaluated = await parsedBody(
      await send(competencesRouter, "POST", `/${id}/evaluate`, {
        passed: true,
        notes: "Aprovado",
        expiresAt: "2027-01-15T00:00:00.000Z",
      }),
      competenceEndpoints.evaluate.response,
    );
    expect(evaluated.status).toBe("ACTIVE");

    const detail = await parsedBody(
      await competencesRouter.request(`/${id}`),
      competenceEndpoints.get.response,
    );
    expect(detail.trainingRecords.map((row) => row.id)).toEqual([training.id]);
    expect(detail.assetTypeName).toBe("Manômetro");

    const audit = await parsedBody(
      await competencesRouter.request(`/${id}/audit-log`),
      competenceEndpoints.auditLog.response,
    );
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["create", "assign_training", "approve"]),
    );

    const suspended = await parsedBody(
      await send(competencesRouter, "POST", `/${id}/suspend`),
      competenceEndpoints.suspend.response,
    );
    expect(suspended.status).toBe("SUSPENDED");
    const renewed = await parsedBody(
      await send(competencesRouter, "POST", `/${id}/renew`, {
        passed: true,
        expiresAt: "2028-01-15T00:00:00.000Z",
      }),
      competenceEndpoints.renew.response,
    );
    expect(renewed.status).toBe("ACTIVE");

    await parsedBody(
      await send(competencesRouter, "DELETE", `/${id}`),
      competenceEndpoints.delete.response,
    );
  });

  it("cancel answers the cancelled row", async () => {
    const lab = await seedOrg({ orgId: "org-comp-cancel", role: "admin" });
    const technician = await seedExtraMember({
      orgId: lab.orgId,
      userId: "tech-comp-cancel",
      role: "technician",
    });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const created = await parsedBody(
      await send(competencesRouter, "POST", "/", {
        userId: technician.userId,
        scopeDescription: "Calibração de paquímetros",
      }),
      competenceEndpoints.create.response,
      201,
    );
    const cancelled = await parsedBody(
      await send(competencesRouter, "POST", `/${created.id}/cancel`, {
        notes: "Pedido duplicado",
      }),
      competenceEndpoints.cancel.response,
    );
    expect(cancelled.status).toBe("CANCELLED");
  });
});
