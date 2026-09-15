/**
 * portal-fleet-oot.int.spec.ts — Real-DB integration tests for issue #740:
 * fleet reliability analytics (Track A) and the asset OOT impact-assessment
 * workflow (Track B).
 *
 * Only the portal session is mocked (test/integration/setup); scoping,
 * permissions and writes run against the seeded Postgres.
 *
 * REQ-FLEET-001  Tenant scoping: customer A never sees customer B's rates
 * REQ-FLEET-002  Rates over KNOWN cycles only + LEGAL-regime exclusion
 * REQ-FLEET-003  Drift series degrades honestly (coverage, no fake regression)
 * REQ-OOT-001    Event creation is idempotent per job (double approval)
 * REQ-OOT-002    Assessment write flips status, records audit row with actor
 *                provenance; second assessment rejected
 * REQ-OOT-003    Tenant scoping on events + assessments
 */

import { beforeEach, describe, expect, it } from "vitest";
import { portalRouter } from "./portal";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  assetOotAuditLog,
  assetOotEvent,
  calibrationJob,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { createAssetOotEventForApprovedJob } from "../lib/asset-oot-events";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
  seedService,
} from "../../test/integration/seed";

const LOCAL_ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = {
  origin: "http://localhost",
  "content-type": "application/json",
} as const;

async function ensureAssetType(name = "Balança"): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name, slug: name.toLowerCase(), definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("ensureAssetType failed");
  return row.id;
}

async function seedAsset(params: {
  labUnitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
  metrologyRegime?: "INDUSTRIAL" | "LEGAL";
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.labUnitId,
      customerId: params.customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: `Ativo ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      metrologyRegime: params.metrologyRegime ?? "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset failed");
  return row.id;
}

function minimalMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Test",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  } satisfies Record<string, unknown>;
}

let jobSeq = 0;

async function seedApprovedJob(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  approvedAt: Date;
  conformity: "CONFORMING" | "NON_CONFORMING" | "UNKNOWN" | null;
  margins?: number[] | null;
}): Promise<number> {
  jobSeq += 1;
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: `JOB-OOT-${jobSeq}`,
      organizationId: params.labOrgId,
      unitId: params.labUnitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      createdBy: params.createdBy,
      status: "APPROVED",
      approvedAt: params.approvedAt,
      asFoundConformity: params.conformity,
      asFoundMargins: params.margins ?? null,
      methodSnapshot: minimalMethodSnapshot(),
      certificateName: `JOB-OOT-${jobSeq}`,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedApprovedJob failed");
  return row.id;
}

type Ctx = Awaited<ReturnType<typeof seedPortalContext>>;

async function seedBaseContext(): Promise<{
  ctx: Ctx;
  assetTypeId: number;
  serviceId: number;
}> {
  const ctx = await seedPortalContext({
    labOrgId: "lab-1",
    clientOrgId: "client-a",
    portalUserId: "user-a",
    customerName: "Customer A",
  });
  const assetTypeId = await ensureAssetType();
  const serviceId = await seedService({
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    name: "Calibração",
  });
  return { ctx, assetTypeId, serviceId };
}

describe("portal fleet analytics + OOT workflow (integration)", () => {
  beforeEach(async () => {
    await truncateAll();
    logoutPortal();
  });

  it("REQ-FLEET-001/002: rates use KNOWN cycles, exclude LEGAL, and stay tenant-scoped", async () => {
    const { ctx, assetTypeId, serviceId } = await seedBaseContext();
    const industrial = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    const legal = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A2",
      metrologyRegime: "LEGAL",
    });
    const base = {
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      serviceId,
      createdBy: ctx.portalUserId,
    };
    await seedApprovedJob({
      ...base,
      assetId: industrial,
      approvedAt: new Date("2026-02-01T00:00:00Z"),
      conformity: "CONFORMING",
    });
    await seedApprovedJob({
      ...base,
      assetId: industrial,
      approvedAt: new Date("2026-05-01T00:00:00Z"),
      conformity: "NON_CONFORMING",
    });
    await seedApprovedJob({
      ...base,
      assetId: industrial,
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      conformity: null, // pre-column job → UNKNOWN
    });
    await seedApprovedJob({
      ...base,
      assetId: legal,
      approvedAt: new Date("2026-06-02T00:00:00Z"),
      conformity: "NON_CONFORMING",
    });

    // Another customer of the same lab with a failure — must never leak
    const customerBId = await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "client-b",
      portalUserId: "user-b",
      customerName: "Customer B",
    });
    const bAsset = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: customerBId,
      assetTypeId,
      tag: "EQ-B1",
    });
    await seedApprovedJob({
      ...base,
      customerId: customerBId,
      assetId: bAsset,
      approvedAt: new Date("2026-06-03T00:00:00Z"),
      conformity: "NON_CONFORMING",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request(
      "/analytics/fleet?periodMonths=24&bucket=quarter",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totals.jobs).toBe(3); // legal excluded, B's job invisible
    expect(body.totals.known).toBe(2);
    expect(body.totals.unknown).toBe(1);
    expect(body.totals.ootRatePct).toBeCloseTo(50, 5);
    expect(body.legalExcluded).toBe(1);
    expect(body.worstOffenders).toHaveLength(1);
    expect(body.worstOffenders[0].tag).toBe("EQ-A1");
    expect(body.attribution).toContain("regra de decisão");
  });

  it("REQ-FLEET-003: drift series exposes matched-point margins and honest coverage", async () => {
    const { ctx, assetTypeId, serviceId } = await seedBaseContext();
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    const base = {
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      serviceId,
      createdBy: ctx.portalUserId,
      assetId,
    };
    await seedApprovedJob({
      ...base,
      approvedAt: new Date("2024-01-01T00:00:00Z"),
      conformity: "CONFORMING",
      margins: [0.5],
    });
    await seedApprovedJob({
      ...base,
      approvedAt: new Date("2025-01-01T00:00:00Z"),
      conformity: "CONFORMING",
      margins: [0.3],
    });
    await seedApprovedJob({
      ...base,
      approvedAt: new Date("2026-01-01T00:00:00Z"),
      conformity: "UNKNOWN",
      margins: null,
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRouter.request(`/assets/${assetId}/drift-series`, {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverage).toEqual({ totalCycles: 3, cyclesWithMargins: 2 });
    expect(body.points[0].series).toHaveLength(2);
    expect(body.points[0].regression).toBeNull(); // n < 3 → no regression
    expect(body.cycles).toHaveLength(3);
  });

  it("REQ-OOT-001: event creation is idempotent per job", async () => {
    const { ctx, assetTypeId, serviceId } = await seedBaseContext();
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    const jobId = await seedApprovedJob({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      serviceId,
      createdBy: ctx.portalUserId,
      assetId,
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      conformity: "NON_CONFORMING",
    });

    const params = {
      jobId,
      assetId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      detectedAt: new Date("2026-06-01T00:00:00Z"),
      actorUserId: ctx.portalUserId,
    };
    const first = await createAssetOotEventForApprovedJob(params);
    expect(first.created).toBe(true);
    const second = await createAssetOotEventForApprovedJob(params);
    expect(second.created).toBe(false);

    const events = await db
      .select({ id: assetOotEvent.id })
      .from(assetOotEvent)
      .where(eq(assetOotEvent.jobId, jobId));
    expect(events).toHaveLength(1);
  });

  it("REQ-OOT-002: assessment write flips status, audits actor, rejects a second write", async () => {
    const { ctx, assetTypeId, serviceId } = await seedBaseContext();
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    // Prior conforming calibration → drives suggestedPeriodStart
    await seedApprovedJob({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      serviceId,
      createdBy: ctx.portalUserId,
      assetId,
      approvedAt: new Date("2025-06-01T00:00:00Z"),
      conformity: "CONFORMING",
    });
    const failingJobId = await seedApprovedJob({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      serviceId,
      createdBy: ctx.portalUserId,
      assetId,
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      conformity: "NON_CONFORMING",
    });
    const { eventId } = await createAssetOotEventForApprovedJob({
      jobId: failingJobId,
      assetId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      detectedAt: new Date("2026-06-01T00:00:00Z"),
      actorUserId: ctx.portalUserId,
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    // Open events list carries the suspect-window default
    const listRes = await portalRouter.request("/oot-events?status=OPEN", {
      headers: LOCAL_ORIGIN,
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].id).toBe(eventId);
    expect(listBody.data[0].suggestedPeriodStart).toContain("2025-06-01");

    const res = await portalRouter.request(
      `/oot-events/${eventId}/assessment`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          decision: "IMPACT_CONTAINED",
          rationale:
            "Medições do período reavaliadas; dois lotes re-inspecionados sem desvio.",
          affectedPeriodStart: "2025-06-01T00:00:00.000Z",
          affectedPeriodEnd: "2026-06-01T00:00:00.000Z",
          suspectProductShipped: true,
          customerNotified: true,
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.event.status).toBe("ASSESSED");
    expect(body.data.assessment.decision).toBe("IMPACT_CONTAINED");
    expect(body.data.assessment.portalUserId).toBe(ctx.portalUserId);

    const auditRows = await db
      .select()
      .from(assetOotAuditLog)
      .where(eq(assetOotAuditLog.eventId, eventId ?? -1));
    expect(auditRows.some((r) => r.action === "assess")).toBe(true);

    // Second assessment rejected (append-only record)
    const again = await portalRouter.request(
      `/oot-events/${eventId}/assessment`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          decision: "NO_IMPACT",
          rationale: "Tentativa de sobrescrever a avaliação registrada.",
        }),
      },
    );
    expect(again.status).toBe(400);
  });

  it("REQ-OOT-003: customer B cannot read or assess customer A's events", async () => {
    const { ctx, assetTypeId, serviceId } = await seedBaseContext();
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });
    const jobId = await seedApprovedJob({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      serviceId,
      createdBy: ctx.portalUserId,
      assetId,
      approvedAt: new Date("2026-06-01T00:00:00Z"),
      conformity: "NON_CONFORMING",
    });
    const { eventId } = await createAssetOotEventForApprovedJob({
      jobId,
      assetId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      detectedAt: new Date("2026-06-01T00:00:00Z"),
      actorUserId: ctx.portalUserId,
    });

    await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "client-b",
      portalUserId: "user-b",
      customerName: "Customer B",
    });
    loginAsPortal({ userId: "user-b", organizationId: "client-b" });

    const listRes = await portalRouter.request("/oot-events", {
      headers: LOCAL_ORIGIN,
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(0);

    const res = await portalRouter.request(
      `/oot-events/${eventId}/assessment`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          decision: "NO_IMPACT",
          rationale: "Tentativa cross-tenant de avaliar evento alheio.",
        }),
      },
    );
    expect(res.status).toBe(404);

    const [row] = await db
      .select({ status: assetOotEvent.status })
      .from(assetOotEvent)
      .where(eq(assetOotEvent.id, eventId ?? -1));
    expect(row?.status).toBe("OPEN");
  });
});
