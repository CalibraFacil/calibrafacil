/**
 * materials-contract.int.spec.ts: the cloud half of the materials endpoint
 * definitions (`packages/contracts/src/endpoints/materials.ts`). Every endpoint
 * but the ERP stock adjust (it needs a linked Conta Azul product) is called for
 * real (real handlers, real middleware, real Postgres) and its body is parsed
 * with the response schema of its definition.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { materialEndpoints } from "@calibra-facil/contracts";
import { materialsRouter } from "./materials";
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

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
  return materialsRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("materials endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("create, list, get, update and deactivate", async () => {
    const org = await seedOrg({
      orgId: "org-materials-contract",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const created = await parsedBody(
      await send("POST", "/", {
        name: "Célula de carga 50kg",
        sku: "CEL-50",
        unitPriceCents: 18000,
      }),
      materialEndpoints.create.response,
      201,
    );
    expect(created.unit).toBe("un");

    const list = await parsedBody(
      await materialsRouter.request("/?page=1&limit=20&isActive=true"),
      materialEndpoints.list.response,
    );
    expect(list.data.map((row) => row.sku)).toEqual(["CEL-50"]);
    expect(list.pagination.total).toBe(1);

    const detail = await parsedBody(
      await materialsRouter.request(`/${created.id}`),
      materialEndpoints.get.response,
    );
    expect(detail.name).toBe("Célula de carga 50kg");

    const updated = await parsedBody(
      await send("PUT", `/${created.id}`, { unitPriceCents: 19000 }),
      materialEndpoints.update.response,
    );
    expect(updated.unitPriceCents).toBe(19000);

    // An update with nothing to change answers the stored row.
    await parsedBody(
      await send("PUT", `/${created.id}`, {}),
      materialEndpoints.update.response,
    );

    const deactivated = await parsedBody(
      await send("DELETE", `/${created.id}`),
      materialEndpoints.deactivate.response,
    );
    expect(deactivated.data.isActive).toBe(false);
  });
});
