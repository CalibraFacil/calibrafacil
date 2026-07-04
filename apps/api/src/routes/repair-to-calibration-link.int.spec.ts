/**
 * repair-to-calibration-link.int.spec.ts — DOM-02 (#655): link a repair service
 * order to the calibration job opened as its follow-up.
 *
 * Real-DB + real-RBAC integration tier. Only the better-auth session and
 * notification side-effects are mocked (see test/integration/setup.ts). The
 * queue route runs through the real withLabPermission → requireOrganization →
 * unit-scope middleware; the link path runs the real createCalibrationJob
 * (published-method gauntlet + org-scoped source-OS resolution) against seeded
 * Postgres.
 *
 * Proven properties (oracle):
 *   REQ-DOM-REP-003  createCalibrationJob records source_service_order_id when the
 *                    source OS is in the caller's org; a cross-tenant source id is
 *                    dropped to null (never linked across the tenant boundary).
 *   REQ-DOM-REP-001  GET /pending-calibration returns finalized OSs flagged
 *                    calibrationRequiredAfterRepair with no calibration opened yet,
 *                    org+unit scoped. Not-finalized, not-flagged, already-linked and
 *                    cross-tenant OSs are all excluded.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { serviceOrdersRouter } from "./service-orders";
import { createCalibrationJob } from "../lib/jobs";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  organization,
  service,
  serviceOrder,
  serviceOrderExecution,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file is fully self-contained and
// parallel worktrees cannot conflict with the shared seed.ts.
// ---------------------------------------------------------------------------

async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer of ${params.labOrgId}`,
      labOrganizationId: params.labOrgId,
      authOrganizationId: params.clientOrgId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `Asset Type ${slug}`, slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: "Test Instrument",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/**
 * Seed a PUBLISHED method with a compiled artifact consistent enough to pass
 * validatePublishedMethodCompiledArtifact in apps/api/src/lib/jobs.ts.
 */
async function seedPublishedMethod(params: {
  organizationId: string;
  assetTypeId: number;
  createdBy: string;
}): Promise<number> {
  const fingerprint = "test-fp-0000000000000001";
  const engineVersion = "0.3.0";
  const optionsFingerprint = "test-opts-fp-00000001";
  const [row] = await db
    .insert(calibrationMethod)
    .values({
      organizationId: params.organizationId,
      assetTypeId: params.assetTypeId,
      name: `Test Method ${params.organizationId}`,
      version: 1,
      status: "PUBLISHED",
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
      methodFingerprint: fingerprint,
      compiledMethod: {
        methodFingerprint: fingerprint,
        normalizedMethodJson: "{}",
        engine: { version: engineVersion, optionsFingerprint },
      },
      methodEngine: { version: engineVersion, optionsFingerprint },
      publicationEvidence: { publishedAt: "2026-01-01T00:00:00.000Z" },
      createdBy: params.createdBy,
    })
    .returning({ id: calibrationMethod.id });
  if (!row) throw new Error("seedPublishedMethod: insert failed");
  return row.id;
}

async function seedService(params: {
  organizationId: string;
  unitId: number;
  methodId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Service ${params.organizationId}`,
      methodId: params.methodId,
      isActive: true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/** Full fixture for one org needed by createCalibrationJob. */
async function seedJobFixture(params: {
  orgId: string;
  userId: string;
  role?: "owner" | "admin" | "technician" | "operator" | "member";
  tagSuffix?: string;
}) {
  const org = await seedOrg({
    orgId: params.orgId,
    userId: params.userId,
    role: params.role ?? "admin",
  });
  const customerId = await seedCustomer({
    labOrgId: params.orgId,
    clientOrgId: `client-${params.orgId}`,
  });
  const tagSuffix = params.tagSuffix ?? params.orgId;
  const assetTypeId = await seedAssetType(`at-${tagSuffix}`);
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId,
    tag: `TAG-${tagSuffix}`,
  });
  const methodId = await seedPublishedMethod({
    organizationId: params.orgId,
    assetTypeId,
    createdBy: params.userId,
  });
  const serviceId = await seedService({
    organizationId: params.orgId,
    unitId: org.unitId,
    methodId,
  });
  return { ...org, customerId, assetTypeId, assetId, serviceId };
}

async function seedServiceOrder(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  openedByUserId: string;
  serviceOrderNumber: string;
}): Promise<number> {
  const [row] = await db
    .insert(serviceOrder)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      openedByUserId: params.openedByUserId,
      serviceOrderNumber: params.serviceOrderNumber,
      status: "awaiting_calibration",
      claimedDefect: "Fora de calibração",
      intakeCondition: "Recebido",
    })
    .returning({ id: serviceOrder.id });
  if (!row) throw new Error("seedServiceOrder: insert failed");
  return row.id;
}

/** Seed the execution row that carries the calibrationRequiredAfterRepair flag. */
async function seedExecution(params: {
  serviceOrderId: number;
  startedByUserId: string;
  calibrationRequiredAfterRepair: boolean;
  finished: boolean;
}): Promise<void> {
  await db.insert(serviceOrderExecution).values({
    serviceOrderId: params.serviceOrderId,
    startedByUserId: params.startedByUserId,
    calibrationRequiredAfterRepair: params.calibrationRequiredAfterRepair,
    result: "repaired",
    finishedAt: params.finished ? new Date("2026-02-01T10:00:00.000Z") : null,
    finishedByUserId: params.finished ? params.startedByUserId : null,
  });
}

// ---------------------------------------------------------------------------

describe("DOM-02 — repair OS → calibration link", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-DOM-REP-003: the created calibration job records the source OS link
  // =========================================================================
  it("REQ-DOM-REP-003: createCalibrationJob persists source_service_order_id for a same-org OS", async () => {
    const orgA = await seedJobFixture({ orgId: "org-a", userId: "user-a" });

    const soId = await seedServiceOrder({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: orgA.customerId,
      assetId: orgA.assetId,
      openedByUserId: orgA.userId,
      serviceOrderNumber: "OS-A-0001",
    });

    const newJob = await createCalibrationJob({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.userId,
      assetId: orgA.assetId,
      serviceId: orgA.serviceId,
      sourceServiceOrderId: soId,
    });

    const [persisted] = await db
      .select({ sourceServiceOrderId: calibrationJob.sourceServiceOrderId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, newJob.id))
      .limit(1);

    expect(persisted?.sourceServiceOrderId).toBe(soId);
  });

  it("REQ-DOM-REP-003: a cross-tenant source OS id is dropped to null (tenancy preserved)", async () => {
    const orgA = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });
    const orgB = await seedJobFixture({
      orgId: "org-b",
      userId: "user-b",
      tagSuffix: "b",
    });

    // A service order that belongs to org B.
    const foreignSoId = await seedServiceOrder({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: orgB.customerId,
      assetId: orgB.assetId,
      openedByUserId: orgB.userId,
      serviceOrderNumber: "OS-B-0001",
    });

    // org A opens a calibration but passes org B's OS id — must not link.
    const newJob = await createCalibrationJob({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.userId,
      assetId: orgA.assetId,
      serviceId: orgA.serviceId,
      sourceServiceOrderId: foreignSoId,
    });

    const [persisted] = await db
      .select({ sourceServiceOrderId: calibrationJob.sourceServiceOrderId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, newJob.id))
      .limit(1);

    expect(persisted?.sourceServiceOrderId).toBeNull();
  });

  // =========================================================================
  // REQ-DOM-REP-001: pending-after-repair queue (org + unit scoped)
  // =========================================================================
  it("REQ-DOM-REP-001: GET /pending-calibration lists only finalized, flagged, not-yet-opened OSs of the caller's org", async () => {
    const orgA = await seedJobFixture({
      orgId: "org-a",
      userId: "user-a",
      tagSuffix: "a",
    });
    const orgB = await seedJobFixture({
      orgId: "org-b",
      userId: "user-b",
      tagSuffix: "b",
    });

    const mkOrderA = (n: string) =>
      seedServiceOrder({
        organizationId: orgA.orgId,
        unitId: orgA.unitId,
        customerId: orgA.customerId,
        assetId: orgA.assetId,
        openedByUserId: orgA.userId,
        serviceOrderNumber: n,
      });

    // (1) finalized + flagged + no calibration opened → SHOULD appear.
    const pendingSo = await mkOrderA("OS-A-PENDING");
    await seedExecution({
      serviceOrderId: pendingSo,
      startedByUserId: orgA.userId,
      calibrationRequiredAfterRepair: true,
      finished: true,
    });

    // (2) flagged but NOT finalized → excluded.
    const notFinishedSo = await mkOrderA("OS-A-UNFINISHED");
    await seedExecution({
      serviceOrderId: notFinishedSo,
      startedByUserId: orgA.userId,
      calibrationRequiredAfterRepair: true,
      finished: false,
    });

    // (3) finalized but NOT flagged → excluded.
    const noFlagSo = await mkOrderA("OS-A-NOFLAG");
    await seedExecution({
      serviceOrderId: noFlagSo,
      startedByUserId: orgA.userId,
      calibrationRequiredAfterRepair: false,
      finished: true,
    });

    // (4) finalized + flagged, but a calibration was ALREADY opened from it
    //     (calibration_job.sourceServiceOrderId set) → excluded (link consumed).
    const linkedSo = await mkOrderA("OS-A-LINKED");
    await seedExecution({
      serviceOrderId: linkedSo,
      startedByUserId: orgA.userId,
      calibrationRequiredAfterRepair: true,
      finished: true,
    });
    await createCalibrationJob({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.userId,
      assetId: orgA.assetId,
      serviceId: orgA.serviceId,
      sourceServiceOrderId: linkedSo,
    });

    // (5) org B: finalized + flagged → must never appear for org A.
    const foreignSo = await seedServiceOrder({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: orgB.customerId,
      assetId: orgB.assetId,
      openedByUserId: orgB.userId,
      serviceOrderNumber: "OS-B-PENDING",
    });
    await seedExecution({
      serviceOrderId: foreignSo,
      startedByUserId: orgB.userId,
      calibrationRequiredAfterRepair: true,
      finished: true,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await serviceOrdersRouter.request("/pending-calibration", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(pendingSo);
    expect(body.data[0].serviceOrderNumber).toBe("OS-A-PENDING");
    // The prefill link fields the OS detail button needs.
    expect(body.data[0].customerId).toBe(orgA.customerId);
    expect(body.data[0].assetId).toBe(orgA.assetId);

    logout();
  });
});
