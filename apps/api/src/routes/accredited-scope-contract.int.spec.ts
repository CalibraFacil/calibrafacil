/**
 * accredited-scope-contract.int.spec.ts: the cloud half of the accredited-scope
 * endpoint definitions (`packages/contracts/src/endpoints/accredited-scope.ts`).
 * Every endpoint is called for real (real handlers, real middleware, real
 * Postgres) and its body is parsed with the response schema of its definition.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { accreditedScopeEndpoints } from "@calibra-facil/contracts";
import { accreditedScopeRouter } from "./accredited-scope";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

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

function send(method: "PUT" | "DELETE", path: string, body?: unknown) {
  return accreditedScopeRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const line = {
  quantityKind: "mass",
  rangeMin: 0,
  rangeMax: 500,
  rangeUnit: "g",
  cmcType: "linear",
  cmcA: 0.01,
  cmcB: 0.0001,
  cmcUnit: "g",
  description: "Balanças classe II",
  validFrom: "2026-01-15T00:00:00.000Z",
};

describe("accredited-scope endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list, save (create and update), setEnforcementMode and delete", async () => {
    const org = await seedOrg({ orgId: "org-scope-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const empty = await parsedBody(
      await accreditedScopeRouter.request("/"),
      accreditedScopeEndpoints.list.response,
    );
    expect(empty.lines).toEqual([]);
    expect(empty.enforcementModeIsDefault).toBe(true);

    const created = await parsedBody(
      await send("PUT", "/", line),
      accreditedScopeEndpoints.save.response,
    );
    expect(created.data.cmcB).toBe(0.0001);
    expect(created.unit.unitId).toBe(org.unitId);

    const updated = await parsedBody(
      await send("PUT", "/", { ...line, id: created.data.id, cmcA: 0.02 }),
      accreditedScopeEndpoints.save.response,
    );
    expect(updated.data.cmcA).toBe(0.02);

    const mode = await parsedBody(
      await send("PUT", "/enforcement", { mode: "enforce" }),
      accreditedScopeEndpoints.setEnforcementMode.response,
    );
    expect(mode.enforcementMode).toBe("enforce");

    const listed = await parsedBody(
      await accreditedScopeRouter.request("/"),
      accreditedScopeEndpoints.list.response,
    );
    expect(listed.lines).toHaveLength(1);
    expect(listed.enforcementMode).toBe("enforce");
    expect(listed.enforcementModeIsDefault).toBe(false);

    await parsedBody(
      await send("DELETE", `/${created.data.id}`),
      accreditedScopeEndpoints.delete.response,
    );
  });
});
