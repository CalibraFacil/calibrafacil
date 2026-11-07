/**
 * services-contract.int.spec.ts: the cloud half of the service-catalog endpoint
 * definitions (`packages/contracts/src/endpoints/services.ts`). Every
 * client-facing services endpoint is called for real (real handlers, real
 * middleware, real Postgres) and its body is parsed with the response schema of
 * its definition. `mount` also checks each body in the integration tier
 * (`checkEndpointResponses`), so a drift fails the request itself.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { serviceEndpoints } from "@calibra-facil/contracts";
import { servicesRouter } from "./services";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedService } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

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

async function seedLab() {
  const org = await seedOrg({ orgId: "org-services-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const headers = { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) };
  const serviceId = await seedService({
    organizationId: org.orgId,
    unitId: org.unitId,
    name: "Calibração de paquímetro",
  });
  return { org, headers, serviceId };
}

describe("services endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list and get", async () => {
    const { headers, serviceId } = await seedLab();

    const list = await parsedBody(
      await servicesRouter.request("/?page=1&limit=20&isActive=true", {
        headers,
      }),
      serviceEndpoints.list.response,
    );
    expect(list.data.map((row) => row.name)).toEqual([
      "Calibração de paquímetro",
    ]);

    const detail = await parsedBody(
      await servicesRouter.request(`/${serviceId}`, { headers }),
      serviceEndpoints.get.response,
    );
    expect(detail.currency).toBe("BRL");
  });

  it("create (201), update and deactivate answer the stored row, and auditLog lists them", async () => {
    const { headers } = await seedLab();

    const created = await parsedBody(
      await servicesRouter.request("/", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Calibração de balança", price: 15000 }),
      }),
      serviceEndpoints.create.response,
      201,
    );
    expect(created).toMatchObject({
      name: "Calibração de balança",
      price: 15000,
    });

    const updated = await parsedBody(
      await servicesRouter.request(`/${created.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ tat: 5 }),
      }),
      serviceEndpoints.update.response,
    );
    expect(updated.tat).toBe(5);

    // A put that changes nothing answers the stored row.
    await parsedBody(
      await servicesRouter.request(`/${created.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({}),
      }),
      serviceEndpoints.update.response,
    );

    const deactivated = await parsedBody(
      await servicesRouter.request(`/${created.id}`, {
        method: "DELETE",
        headers,
      }),
      serviceEndpoints.deactivate.response,
    );
    expect(deactivated.data.isActive).toBe(false);

    const log = await parsedBody(
      await servicesRouter.request(`/${created.id}/audit-log`, { headers }),
      serviceEndpoints.auditLog.response,
    );
    expect(log.data.map((entry) => entry.action).sort()).toEqual([
      "create",
      "deactivate",
      "update",
    ]);
  });
});
