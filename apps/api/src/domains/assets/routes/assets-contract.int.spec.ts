/**
 * assets-contract.int.spec.ts: the cloud half of the assets endpoint
 * definitions (`packages/contracts/src/endpoints/assets.ts`) for the endpoints
 * `reference-data-contract.int.spec.ts` does not reach: the update answer and the
 * audit log. (Create, list and detail are parsed there, with the same
 * definitions.) `mount` also checks each body in the integration tier
 * (`checkEndpointResponses`).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { assetEndpoints } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { asset, assetType } from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { assetsRouter } from "./assets";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedCustomer, seedOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

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
  const org = await seedOrg({ orgId: "org-assets-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: "Cliente Contrato",
  });
  const [type] = await db
    .insert(assetType)
    .values({
      name: "Balança",
      slug: "balanca-assets-contract",
      definition: [],
    })
    .returning({ id: assetType.id });
  const [assetRow] = await withStatusRepair((tx) =>
    tx
      .insert(asset)
      .values({
        unitId: org.unitId,
        customerId,
        labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerId})`,
        assetTypeId: type?.id ?? 0,
        name: "Balança analítica",
        serialNumber: "SN-AC",
        tag: "TAG-AC",
        baseMeasurementUnit: "g",
        status: "ACTIVE",
      })
      .returning({ id: asset.id }),
  );
  if (!assetRow) throw new Error("seedLab: asset insert failed");
  return {
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
    assetId: assetRow.id,
  };
}

describe("assets endpoints: update and audit log honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("update answers the stored row and auditLog lists the change", async () => {
    const { headers, assetId } = await seedLab();

    const updated = await parsedBody(
      await assetsRouter.request(`/${assetId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ name: "Balança renomeada", comments: "ok" }),
      }),
      assetEndpoints.update.response,
    );
    expect(updated).toMatchObject({ name: "Balança renomeada" });

    const log = await parsedBody(
      await assetsRouter.request(`/${assetId}/audit-log`, { headers }),
      assetEndpoints.auditLog.response,
    );
    expect(log.data.map((entry) => entry.action)).toContain("update");
  });
});
