import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { material, service } from "@calibra-facil/db/schema";
import { normalizeContaAzulConnectionConfig } from "@calibra-facil/shared";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import {
  filterContaAzulCatalogPayloadsByEnabledKinds,
  loadCatalogItemPayloads,
} from "../integrations";

// Real-DB integration test for the catalog payload loader now that the
// catalog covers BOTH halves of the Conta Azul split: services
// (/v1/servicos) and materials-as-products (/v1/produtos).
//
// Proven properties:
//   REQ-MATERP-001  loadCatalogItemPayloads emits materials as kind:"product"
//                   payloads (externalId material:{id}, SKU-based code,
//                   priceCents from unitPriceCents, active flag) alongside
//                   the existing kind:"service" payloads
//   REQ-MATERP-002  Materials without SKU fall back to a stable MAT-{id} code
//   REQ-MATERP-003  Inactive materials are emitted with active:false so the
//                   remote product gets INATIVO (soft-delete propagation)
//   REQ-MATERP-004  Payloads are tenant-scoped — another org's materials and
//                   services never appear
//   REQ-MATERP-005  filterContaAzulCatalogPayloadsByEnabledKinds keeps only
//                   the kinds the connection enabled (services vs products
//                   are independent switches)

async function seedServiceRow(params: {
  organizationId: string;
  unitId: number;
  name: string;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name,
      price: 10_000,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedServiceRow: insert failed");
  return row.id;
}

async function seedMaterialRow(params: {
  organizationId: string;
  unitId: number;
  name: string;
  sku?: string | null;
  unitPriceCents?: number | null;
  isActive?: boolean;
}): Promise<number> {
  const [row] = await db
    .insert(material)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name,
      sku: params.sku ?? null,
      unit: "un",
      unitPriceCents: params.unitPriceCents ?? null,
      isActive: params.isActive ?? true,
    })
    .returning({ id: material.id });
  if (!row) throw new Error("seedMaterialRow: insert failed");
  return row.id;
}

describe("loadCatalogItemPayloads — services + materials (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-MATERP-001/002/003/004: emits service and material payloads, tenant-scoped", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const serviceId = await seedServiceRow({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      name: "Calibração de balança",
    });
    const skuMaterialId = await seedMaterialRow({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      name: "Célula de carga 50kg",
      sku: "CEL-050",
      unitPriceCents: 80_000,
    });
    const bareMaterialId = await seedMaterialRow({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      name: "Display LCD",
      isActive: false,
    });
    await seedMaterialRow({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      name: "Material de outro laboratório",
    });

    const payloads = await loadCatalogItemPayloads(orgA.orgId, 50);
    const byExternalId = new Map(
      payloads.map((payload) => [payload.externalId, payload]),
    );

    expect(byExternalId.has(`service:${serviceId}`)).toBe(true);
    expect(byExternalId.get(`material:${skuMaterialId}`)).toMatchObject({
      kind: "product",
      code: "CEL-050",
      name: "Célula de carga 50kg",
      priceCents: 80_000,
      currency: "BRL",
      active: true,
    });
    expect(byExternalId.get(`material:${bareMaterialId}`)).toMatchObject({
      kind: "product",
      code: `MAT-${bareMaterialId}`,
      priceCents: null,
      active: false,
    });

    // Tenant boundary: nothing from org B leaks into org A's payloads.
    expect(
      payloads.every((payload) => payload.organizationId === orgA.orgId),
    ).toBe(true);
    expect(
      [...byExternalId.values()].some(
        (payload) => payload.name === "Material de outro laboratório",
      ),
    ).toBe(false);
  });

  it("REQ-MATERP-005: filters catalog payloads by the connection's enabled kinds", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedServiceRow({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Serviço",
    });
    await seedMaterialRow({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Material",
    });

    const payloads = await loadCatalogItemPayloads(org.orgId, 50);
    expect(payloads).toHaveLength(2);

    const servicesOnly = filterContaAzulCatalogPayloadsByEnabledKinds(
      normalizeContaAzulConnectionConfig({
        enabledTargets: { services: true, products: false },
      }),
      payloads,
    );
    expect(servicesOnly.map((payload) => payload.kind)).toEqual(["service"]);

    const productsOnly = filterContaAzulCatalogPayloadsByEnabledKinds(
      normalizeContaAzulConnectionConfig({
        enabledTargets: { services: false, products: true },
      }),
      payloads,
    );
    expect(productsOnly.map((payload) => payload.kind)).toEqual(["product"]);

    const both = filterContaAzulCatalogPayloadsByEnabledKinds(
      normalizeContaAzulConnectionConfig({
        enabledTargets: { services: true, products: true },
      }),
      payloads,
    );
    expect(both).toHaveLength(2);
  });
});
