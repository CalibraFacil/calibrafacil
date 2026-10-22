/**
 * reference-data-contract.int.spec.ts: P2-15 REQ-TC-4. The cloud half of the
 * desktop parity contract: the REAL responses (real handlers, real middleware,
 * real Postgres) of the endpoints the offline desktop mirrors must parse with
 * the same schemas in `@calibra-facil/contracts` that
 * `apps/local-server/src/contract.test.ts` holds the local server to. If either
 * side changes a shape, its own test fails before the two can drift apart.
 *
 * Covered: customers (list, detail), asset types (list), assets (create, list,
 * detail), methods (list, detail), service orders (create, list, detail).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  assetDetailSchema,
  assetRecordSchema,
  assetTypesResponseSchema,
  assetsListResponseSchema,
  customerDetailSchema,
  customersListResponseSchema,
  methodDetailSchema,
  methodsListResponseSchema,
  serviceOrderCreateResponseSchema,
  serviceOrderDetailResponseSchema,
  serviceOrdersListResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { asset, assetType, calibrationMethod } from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { assetTypesRouter } from "./asset-types";
import { assetsRouter } from "./assets";
import { customersRouter } from "./customers";
import { methodsRouter } from "./methods";
import { serviceOrdersRouter } from "./service-orders";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

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

async function seedLab() {
  const org = await seedOrg({ orgId: "org-ref-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: "Cliente Contrato",
    taxId: "12.345.678/0001-90",
  });
  const [type] = await db
    .insert(assetType)
    .values({
      name: "Balança",
      slug: "balanca-ref-contract",
      definition: [
        {
          key: "capacity",
          label: "Capacidade",
          type: "number",
          required: false,
        },
      ],
    })
    .returning({ id: assetType.id });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerId})`,
      assetTypeId: type?.id ?? 0,
      name: "Balança analítica",
      serialNumber: "SN-REF",
      tag: "TAG-REF",
      baseMeasurementUnit: "g",
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  return {
    org,
    customerId,
    assetTypeId: type?.id ?? 0,
    assetId: assetRow?.id ?? 0,
  };
}

describe("reference-data endpoints: real responses honor the contract schemas (P2-15 REQ-TC-4)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TC-4: customers list and detail parse", async () => {
    const lab = await seedLab();

    const list = await parsedBody(
      await customersRouter.request("/?page=1&limit=20"),
      customersListResponseSchema,
    );
    expect(list.data.map((customer) => customer.name)).toEqual([
      "Cliente Contrato",
    ]);
    const detail = await parsedBody(
      await customersRouter.request(`/${lab.customerId}`),
      customerDetailSchema,
    );
    expect(detail.financialSummary.openBalanceCents).toBe(0);
  });

  it("REQ-TC-4: asset types list parses, slug included", async () => {
    await seedLab();

    const list = await parsedBody(
      await assetTypesRouter.request("/"),
      assetTypesResponseSchema,
    );
    expect(list.data.map((type) => type.slug)).toEqual([
      "balanca-ref-contract",
    ]);
  });

  it("REQ-TC-4: assets create (201), list and detail parse", async () => {
    const lab = await seedLab();

    const created = await parsedBody(
      await assetsRouter.request("/", {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-active-unit-id": String(lab.org.unitId),
        },
        body: JSON.stringify({
          customerId: lab.customerId,
          assetTypeId: lab.assetTypeId,
          name: "Balança de bancada",
          serialNumber: "SN-NEW",
          tag: "TAG-NEW",
          baseMeasurementUnit: "g",
          status: "ACTIVE",
        }),
      }),
      assetRecordSchema,
      201,
    );
    expect(created.tag).toBe("TAG-NEW");

    const list = await parsedBody(
      await assetsRouter.request("/?page=1&limit=20"),
      assetsListResponseSchema,
    );
    expect(list.data.map((item) => item.tag).sort()).toEqual([
      "TAG-NEW",
      "TAG-REF",
    ]);
    const detail = await parsedBody(
      await assetsRouter.request(`/${lab.assetId}`),
      assetDetailSchema,
    );
    expect(detail.assetTypeSlug).toBe("balanca-ref-contract");
  });

  it("REQ-TC-4: methods list and detail parse", async () => {
    const lab = await seedLab();
    const [method] = await db
      .insert(calibrationMethod)
      .values({
        organizationId: lab.org.orgId,
        assetTypeId: lab.assetTypeId,
        name: "Erro de indicação",
        version: 1,
        status: "PUBLISHED",
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
        createdBy: lab.org.userId,
        publishedAt: new Date("2026-01-02T00:00:00.000Z"),
      })
      .returning({ id: calibrationMethod.id });

    const list = await parsedBody(
      await methodsRouter.request("/?status=PUBLISHED&limit=100"),
      methodsListResponseSchema,
    );
    expect(list.data.map((item) => item.name)).toEqual(["Erro de indicação"]);
    const detail = await parsedBody(
      await methodsRouter.request(`/${method?.id}`),
      methodDetailSchema,
    );
    expect(detail.assetTypeName).toBe("Balança");
  });

  it("REQ-TC-4: service orders create (201), list and detail parse", async () => {
    const lab = await seedLab();

    const created = await parsedBody(
      await serviceOrdersRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          customerId: lab.customerId,
          assetId: lab.assetId,
          claimedDefect: "Display apagado",
          intakeCondition: "Sem avarias aparentes",
        }),
      }),
      serviceOrderCreateResponseSchema,
      201,
    );

    const list = await parsedBody(
      await serviceOrdersRouter.request("/?page=1&limit=20"),
      serviceOrdersListResponseSchema,
    );
    expect(list.data.map((order) => order.publicId)).toEqual([
      created.data.publicId,
    ]);
    const detail = await parsedBody(
      await serviceOrdersRouter.request(`/${created.data.id}`),
      serviceOrderDetailResponseSchema,
    );
    expect(detail.data.claimedDefect).toBe("Display apagado");
  });
});
