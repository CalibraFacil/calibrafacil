/**
 * portal-overview-contract.int.spec.ts: REQ-TC-5 for the portal. The real
 * `GET /api/portal/overview` response (real handler, real portal middleware,
 * real Postgres) must parse with `portalOverviewResponseSchema`, the schema the
 * portal validates its dashboard fetch with. Every section is populated so each
 * nested row shape (equipment, certificate, request, service order) is checked,
 * and the empty overview a customer without data receives is checked too.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { portalOverviewResponseSchema } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationRequest,
  service,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { portalRouter } from "./portal";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedPortalContext } from "../../test/integration/seed";

const LOCAL_ORIGIN = { origin: "http://localhost" };

async function getOverview() {
  const response = await portalRouter.request("/overview", {
    headers: LOCAL_ORIGIN,
  });
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  const result = portalOverviewResponseSchema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return portalOverviewResponseSchema.parse(body);
}

describe("portal overview: the real response honors the contract schema (REQ-TC-5)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TC-5: a populated overview parses (equipment, certificate, request and service order rows)", async () => {
    const ctx = await seedPortalContext();
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca-portal", definition: [] })
      .returning({ id: assetType.id });
    const [assetRow] = await db
      .insert(asset)
      .values({
        unitId: ctx.labUnitId,
        customerId: ctx.customerId,
        labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${ctx.customerId})`,
        assetTypeId: type?.id ?? 0,
        name: "Balança A",
        serialNumber: "SN-A1",
        tag: "EQ-A1",
        status: "ACTIVE",
        nextCalibrationDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: asset.id });
    const assetId = assetRow?.id ?? 0;

    await db.insert(calibrationRequest).values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      authOrganizationId: ctx.clientOrgId,
      submittedBy: ctx.portalUserId,
      status: "PENDING",
    });

    await db.insert(serviceOrder).values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId,
      openedByUserId: ctx.portalUserId,
      serviceOrderNumber: "OS-0001",
      status: "awaiting_quote_approval",
      claimedDefect: "Não liga",
      intakeCondition: "Sem avarias",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: 0,
      totalApprovedCents: 0,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
    });

    const [serviceRow] = await db
      .insert(service)
      .values({
        organizationId: ctx.labOrgId,
        unitId: ctx.labUnitId,
        name: "Calibração",
        isActive: true,
      })
      .returning({ id: service.id });
    await db.insert(calibrationJob).values({
      jobId: "CAL-PORTAL-1",
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId,
      serviceId: serviceRow?.id ?? 0,
      createdBy: ctx.portalUserId,
      status: "APPROVED",
      approvedAt: new Date("2026-05-20T10:00:00.000Z"),
      certificateUrl: "/certificates/portal-1.pdf",
      methodSnapshot: {
        methodId: 1,
        methodName: "Método",
        methodVersion: 1,
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
      },
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const overview = await getOverview();

    expect(overview.equipment.attention.map((item) => item.name)).toEqual([
      "Balança A",
    ]);
    expect(overview.certificates.recent.map((item) => item.jobId)).toEqual([
      "CAL-PORTAL-1",
    ]);
    expect(overview.requests.recent.map((item) => item.status)).toEqual([
      "PENDING",
    ]);
    expect(overview.serviceOrders.awaitingQuote.map((o) => o.status)).toEqual([
      "awaiting_quote_approval",
    ]);
  });

  it("REQ-TC-5: the overview of a customer without any data parses", async () => {
    const ctx = await seedPortalContext();
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const overview = await getOverview();

    expect(overview.equipment.total).toBe(0);
    expect(overview.requests.recent).toEqual([]);
  });
});
