/**
 * proficiency-tests-contract.int.spec.ts: the cloud half of the proficiency-tests
 * endpoint definitions (`packages/contracts/src/endpoints/proficiency-tests.ts`).
 * The register and the participation plan are driven for real (real handlers,
 * real middleware, real Postgres) and every body is parsed with the response
 * schema of its definition. `mount` also checks each body with that schema in
 * the integration tier (`checkEndpointResponses`); the explicit parse names the
 * status and the drifting path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { proficiencyTestEndpoints } from "@calibra-facil/contracts";
import { proficiencyTestsRouter } from "./proficiency-tests";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

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

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
  return proficiencyTestsRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("proficiency-tests endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("register: create, list, get, update, record results, summary, audit log and remove", async () => {
    const lab = await seedOrg({ orgId: "org-pt-contract", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const created = await parsedBody(
      await send("POST", "/", {
        provider: "Provedor Alfa",
        ptRound: "PT-2026-01",
        scopePart: "Massa",
      }),
      proficiencyTestEndpoints.create.response,
      201,
    );
    expect(created.overallStatus).toBe("pending");
    const id = created.id;

    const list = await parsedBody(
      await proficiencyTestsRouter.request("/?page=1&limit=20"),
      proficiencyTestEndpoints.list.response,
    );
    expect(list.data.map((row) => row.ptRound)).toEqual(["PT-2026-01"]);

    const updated = await parsedBody(
      await send("PUT", `/${id}`, { notes: "Rodada anual" }),
      proficiencyTestEndpoints.update.response,
    );
    expect(updated.notes).toBe("Rodada anual");

    const recorded = await parsedBody(
      await send("POST", `/${id}/results`, {
        resultReportedAt: "2026-03-01T00:00:00.000Z",
        results: [
          {
            label: "100 g",
            unit: "g",
            labValue: 100.001,
            labUncertainty: 0.002,
            refValue: 100,
            refUncertainty: 0.002,
            scoreType: "en",
          },
        ],
      }),
      proficiencyTestEndpoints.recordResults.response,
    );
    expect(recorded.overallStatus).toBe("satisfactory");

    const detail = await parsedBody(
      await proficiencyTestsRouter.request(`/${id}`),
      proficiencyTestEndpoints.get.response,
    );
    expect(detail.results).toHaveLength(1);
    expect(detail.createdByName).toBe(`User ${lab.userId}`);

    const summary = await parsedBody(
      await proficiencyTestsRouter.request("/summary"),
      proficiencyTestEndpoints.summary.response,
    );
    expect(summary).toMatchObject({ total: 1, satisfactory: 1 });

    const audit = await parsedBody(
      await proficiencyTestsRouter.request(`/${id}/audit-log`),
      proficiencyTestEndpoints.auditLog.response,
    );
    expect(audit.data.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["create", "record_results"]),
    );

    await parsedBody(
      await send("DELETE", `/${id}`),
      proficiencyTestEndpoints.remove.response,
    );
  });

  it("participation plan: create, list, update and remove an item", async () => {
    const lab = await seedOrg({ orgId: "org-pt-plan-contract", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const item = await parsedBody(
      await send("POST", "/plan", { scopePart: "Temperatura" }),
      proficiencyTestEndpoints.createPlanItem.response,
      201,
    );
    expect(item.frequencyMonths).toBe(48);

    const plan = await parsedBody(
      await proficiencyTestsRouter.request("/plan"),
      proficiencyTestEndpoints.listPlan.response,
    );
    expect(plan.data.map((row) => row.scopePart)).toEqual(["Temperatura"]);

    const updated = await parsedBody(
      await send("PUT", `/plan/${item.id}`, {
        frequencyMonths: 24,
        lastSatisfactoryAt: "2026-01-01T00:00:00.000Z",
      }),
      proficiencyTestEndpoints.updatePlanItem.response,
    );
    expect(updated.frequencyMonths).toBe(24);

    await parsedBody(
      await send("DELETE", `/plan/${item.id}`),
      proficiencyTestEndpoints.removePlanItem.response,
    );
  });
});
