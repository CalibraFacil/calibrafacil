/**
 * tenant-refs.int.spec.ts — Real-DB + real-RBAC integration tests proving that
 * ids named in a finance request BODY (units, services, commercial agreements)
 * must belong to the caller's organization. Only the better-auth session is
 * mocked (see test/integration/setup.ts).
 *
 * REQ-TENANT-FIN-001  contract POST: another org's unitId in unitIds → 400
 * REQ-TENANT-FIN-002  contract POST: another org's serviceId in a term → 400
 * REQ-TENANT-FIN-003  contract POST: another org's unitId on a term → 400
 * REQ-TENANT-FIN-004  contract PUT: foreign ids refused, existing scope untouched
 * REQ-TENANT-FIN-005  contract POST with own unit/service still → 201
 * REQ-TENANT-FIN-006  release-policy POST: another org's commercialAgreementId → 400
 * REQ-TENANT-FIN-007  automatic-send rule POST: another org's commercialAgreementId → 400
 */

import { beforeEach, describe, expect, it } from "vitest";
import { financeContractsRouter } from "./contracts";
import { financeAutomaticSendRouter } from "./automatic-send";
import { settingsCertificateReleasePolicyRouter } from "./certificate-release";
import { db } from "@calibra-facil/db";
import {
  automaticSendRule,
  certificateReleasePolicy,
  commercialAgreement,
  commercialAgreementServiceTerm,
  commercialAgreementUnitScope,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedService,
} from "../../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

async function seedFixture() {
  const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
  const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
  const customerA = await seedCustomer({
    labOrganizationId: orgA.orgId,
    name: "Cliente A",
  });
  const customerB = await seedCustomer({
    labOrganizationId: orgB.orgId,
    name: "Cliente B",
  });
  const serviceA = await seedService({
    organizationId: orgA.orgId,
    unitId: orgA.unitId,
    name: "Calibração A",
  });
  const serviceB = await seedService({
    organizationId: orgB.orgId,
    unitId: orgB.unitId,
    name: "Calibração B",
  });
  const [agreementB] = await db
    .insert(commercialAgreement)
    .values({
      organizationId: orgB.orgId,
      customerId: customerB,
      title: "Contrato B",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: orgB.userId,
      updatedBy: orgB.userId,
    })
    .returning({ id: commercialAgreement.id });
  if (!agreementB) throw new Error("seed agreement B failed");
  return {
    orgA,
    orgB,
    customerA,
    serviceA,
    serviceB,
    agreementB: agreementB.id,
  };
}

function contractBody(
  fx: Awaited<ReturnType<typeof seedFixture>>,
  overrides: {
    unitIds?: number[];
    serviceId?: number;
    termUnitId?: number | null;
  } = {},
) {
  return JSON.stringify({
    customerId: fx.customerA,
    title: "Contrato A",
    effectiveFrom: "2026-02-01T00:00:00.000Z",
    unitIds: overrides.unitIds ?? [fx.orgA.unitId],
    serviceTerms: [
      {
        serviceId: overrides.serviceId ?? fx.serviceA,
        unitId: overrides.termUnitId ?? null,
        priceCents: 10000,
      },
    ],
  });
}

async function agreementsOf(orgId: string) {
  return db
    .select({ id: commercialAgreement.id })
    .from(commercialAgreement)
    .where(eq(commercialAgreement.organizationId, orgId));
}

describe("finance routers — request-supplied foreign ids are tenant-scoped", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TENANT-FIN-001 [HIGH RISK]: POST contract with another org's unit in unitIds → 400, no contract created", async () => {
    const fx = await seedFixture();

    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const res = await financeContractsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: contractBody(fx, { unitIds: [fx.orgB.unitId] }),
    });

    expect(res.status).toBe(400);
    expect(await agreementsOf(fx.orgA.orgId)).toHaveLength(0);
  });

  it("REQ-TENANT-FIN-002 [HIGH RISK]: POST contract with another org's service in a term → 400, no contract created", async () => {
    const fx = await seedFixture();

    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const res = await financeContractsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: contractBody(fx, { serviceId: fx.serviceB }),
    });

    expect(res.status).toBe(400);
    expect(await agreementsOf(fx.orgA.orgId)).toHaveLength(0);
  });

  it("REQ-TENANT-FIN-003: POST contract with another org's unit on a term → 400, no contract created", async () => {
    const fx = await seedFixture();

    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const res = await financeContractsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: contractBody(fx, { termUnitId: fx.orgB.unitId }),
    });

    expect(res.status).toBe(400);
    expect(await agreementsOf(fx.orgA.orgId)).toHaveLength(0);
  });

  it("REQ-TENANT-FIN-004 [HIGH RISK]: PUT contract with foreign unit/service → 400, existing scope and terms untouched", async () => {
    const fx = await seedFixture();
    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const created = await financeContractsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: contractBody(fx),
    });
    expect(created.status).toBe(201);
    const { data } = await created.json();

    const foreignUnit = await financeContractsRouter.request(`/${data.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: contractBody(fx, { unitIds: [fx.orgB.unitId] }),
    });
    const foreignService = await financeContractsRouter.request(`/${data.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: contractBody(fx, { serviceId: fx.serviceB }),
    });

    expect(foreignUnit.status).toBe(400);
    expect(foreignService.status).toBe(400);
    const scopes = await db
      .select({ unitId: commercialAgreementUnitScope.unitId })
      .from(commercialAgreementUnitScope)
      .where(eq(commercialAgreementUnitScope.agreementId, data.id));
    expect(scopes.map((row) => row.unitId)).toEqual([fx.orgA.unitId]);
    const terms = await db
      .select({ serviceId: commercialAgreementServiceTerm.serviceId })
      .from(commercialAgreementServiceTerm)
      .where(eq(commercialAgreementServiceTerm.agreementId, data.id));
    expect(terms.map((row) => row.serviceId)).toEqual([fx.serviceA]);
  });

  it("REQ-TENANT-FIN-005: POST contract with the caller's own unit and service → 201", async () => {
    const fx = await seedFixture();

    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const res = await financeContractsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: contractBody(fx, { termUnitId: fx.orgA.unitId }),
    });

    expect(res.status).toBe(201);
    expect(await agreementsOf(fx.orgA.orgId)).toHaveLength(1);
  });

  it("REQ-TENANT-FIN-006 [HIGH RISK]: POST certificate-release policy pinned to another org's agreement → 400, no policy created", async () => {
    const fx = await seedFixture();

    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const res = await settingsCertificateReleasePolicyRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        mode: "trusted_customer",
        commercialAgreementId: fx.agreementB,
      }),
    });

    expect(res.status).toBe(400);
    const rows = await db
      .select({ id: certificateReleasePolicy.id })
      .from(certificateReleasePolicy)
      .where(eq(certificateReleasePolicy.organizationId, fx.orgA.orgId));
    expect(rows).toHaveLength(0);
  });

  it("REQ-TENANT-FIN-007 [HIGH RISK]: POST automatic-send rule pinned to another org's agreement → 400, no rule created", async () => {
    const fx = await seedFixture();

    loginAs({ userId: fx.orgA.userId, organizationId: fx.orgA.orgId });
    const res = await financeAutomaticSendRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        milestone: "manual_only",
        commercialAgreementId: fx.agreementB,
      }),
    });

    expect(res.status).toBe(400);
    const rows = await db
      .select({ id: automaticSendRule.id })
      .from(automaticSendRule)
      .where(eq(automaticSendRule.organizationId, fx.orgA.orgId));
    expect(rows).toHaveLength(0);
  });
});
