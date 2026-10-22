/**
 * environmental-limits-contract.int.spec.ts: P2-15 REQ-TC-1. The environmental
 * limits endpoints' REAL responses (real handlers, real middleware, real
 * Postgres) must parse with the response schemas in `@calibra-facil/contracts`
 * that the client SDK validates against and the desktop local-server mirrors.
 *
 * Covered: GET /, GET /effective/:assetTypeId (unit default, asset-type
 * override, nothing configured), PUT / and DELETE /:id.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  deleteEnvironmentalLimitResponseSchema,
  effectiveEnvironmentalLimitsResponseSchema,
  environmentalLimitsResponseSchema,
  saveEnvironmentalLimitResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { assetType } from "@calibra-facil/db/schema";
import { environmentalLimitsRouter } from "./environmental-limits";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

const NO_LIMITS = {
  temperatureMin: null,
  temperatureMax: null,
  humidityMin: null,
  humidityMax: null,
  pressureMin: null,
  pressureMax: null,
};

/** Parses with the contract schema; the issues name the drifting path on failure. */
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

function put(body: unknown) {
  return environmentalLimitsRouter.request("/", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe("environmental-limits endpoints: real responses honor the contract schemas (P2-15 REQ-TC-1)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TC-1: PUT /, GET / and DELETE /:id parse (unit default and asset-type override)", async () => {
    const org = await seedOrg({ orgId: "org-el-contract", role: "admin" });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca-el-contract", definition: [] })
      .returning({ id: assetType.id });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const saved = await parsedBody(
      await put({
        assetTypeId: null,
        ...NO_LIMITS,
        temperatureMin: 18,
        temperatureMax: 25,
      }),
      saveEnvironmentalLimitResponseSchema,
    );
    expect(saved.data.temperatureMax).toBe(25);
    expect(saved.unit.unitId).toBe(org.unitId);

    await parsedBody(
      await put({
        assetTypeId: type?.id,
        ...NO_LIMITS,
        humidityMin: 30,
        humidityMax: 60,
      }),
      saveEnvironmentalLimitResponseSchema,
    );

    const list = await parsedBody(
      await environmentalLimitsRouter.request("/"),
      environmentalLimitsResponseSchema,
    );
    expect(list.limits).toHaveLength(2);
    expect(list.limits.map((limit) => limit.assetTypeName).sort()).toEqual([
      "Balança",
      null,
    ]);

    await parsedBody(
      await environmentalLimitsRouter.request(`/${saved.data.id}`, {
        method: "DELETE",
      }),
      deleteEnvironmentalLimitResponseSchema,
    );
  });

  it("REQ-TC-1: GET /effective/:assetTypeId names its source: asset_type, unit_default, or null", async () => {
    const org = await seedOrg({ orgId: "org-el-contract", role: "admin" });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca-el-effective", definition: [] })
      .returning({ id: assetType.id });
    const [other] = await db
      .insert(assetType)
      .values({ name: "Termômetro", slug: "termometro-el", definition: [] })
      .returning({ id: assetType.id });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Nothing configured yet.
    const none = await parsedBody(
      await environmentalLimitsRouter.request(`/effective/${type?.id}`),
      effectiveEnvironmentalLimitsResponseSchema,
    );
    expect(none).toMatchObject({ limits: null, source: null });

    await put({ assetTypeId: null, ...NO_LIMITS, temperatureMax: 25 });
    const fallback = await parsedBody(
      await environmentalLimitsRouter.request(`/effective/${type?.id}`),
      effectiveEnvironmentalLimitsResponseSchema,
    );
    expect(fallback.source).toBe("unit_default");

    await put({ assetTypeId: type?.id, ...NO_LIMITS, temperatureMax: 23 });
    const override = await parsedBody(
      await environmentalLimitsRouter.request(`/effective/${type?.id}`),
      effectiveEnvironmentalLimitsResponseSchema,
    );
    expect(override.source).toBe("asset_type");
    expect(override.limits?.temperatureMax).toBe(23);

    // The other type still falls back to the unit default.
    const otherType = await parsedBody(
      await environmentalLimitsRouter.request(`/effective/${other?.id}`),
      effectiveEnvironmentalLimitsResponseSchema,
    );
    expect(otherType.source).toBe("unit_default");
  });
});
