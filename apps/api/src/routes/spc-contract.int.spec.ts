/**
 * spc-contract.int.spec.ts: the cloud half of the SPC endpoint definitions
 * (`packages/contracts/src/endpoints/spc.ts`). Every endpoint is called for
 * real (real handlers, real middleware, real Postgres) and its body is parsed
 * with the response schema of its definition. `mount` also checks each body
 * with that schema in the integration tier (`checkEndpointResponses`); the
 * explicit parse names the status and the drifting path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { spcEndpoints } from "@calibra-facil/contracts";
import { spcRouter } from "./spc";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";

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
  return spcRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("spc endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("charts and readings", async () => {
    const lab = await seedOrg({ orgId: "org-spc-contract", role: "admin" });
    const standardId = await seedStandard({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      createdBy: lab.userId,
    });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const chart = await parsedBody(
      await send("POST", "/charts", {
        standardId,
        parameter: "100 g",
        chartType: "i_mr",
        params: { baselineWindow: 8 },
      }),
      spcEndpoints.createChart.response,
      201,
    );
    expect(chart.status).toBe("insufficient_data");

    const values = [
      10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02, 9.98, 10.0,
    ];
    for (const [index, value] of values.entries()) {
      await parsedBody(
        await send("POST", "/readings", {
          standardId,
          parameter: "100 g",
          value,
          measuredAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        }),
        spcEndpoints.createReading.response,
        201,
      );
    }

    const readings = await parsedBody(
      await spcRouter.request(`/readings?standardId=${standardId}`),
      spcEndpoints.listReadings.response,
    );
    expect(readings.data).toHaveLength(values.length);

    const list = await parsedBody(
      await spcRouter.request("/charts?page=1&limit=50"),
      spcEndpoints.listCharts.response,
    );
    expect(list.data.map((row) => row.parameter)).toEqual(["100 g"]);

    const detail = await parsedBody(
      await spcRouter.request(`/charts/${chart.id}`),
      spcEndpoints.getChart.response,
    );
    expect(detail.readings).toHaveLength(values.length);
    expect(detail.lastEvaluation?.sampleSize).toBe(values.length);

    await parsedBody(
      await send("PUT", `/charts/${chart.id}`, { chartType: "ewma" }),
      spcEndpoints.updateChart.response,
    );
    const recalculated = await parsedBody(
      await send("POST", `/charts/${chart.id}/recalculate`),
      spcEndpoints.recalculateChart.response,
    );
    expect(recalculated.chartType).toBe("ewma");

    await parsedBody(
      await send("DELETE", `/readings/${readings.data[0]?.id}`),
      spcEndpoints.removeReading.response,
    );
    await parsedBody(
      await send("DELETE", `/charts/${chart.id}`),
      spcEndpoints.removeChart.response,
    );
  });
});
