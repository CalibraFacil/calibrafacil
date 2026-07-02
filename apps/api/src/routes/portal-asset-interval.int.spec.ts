import { beforeEach, describe, expect, it } from "vitest";
import { portalRouter } from "./portal";
import { db } from "@calibra-facil/db";
import { asset, assetAuditLog, assetType } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the customer-owned calibration interval
// write endpoint (PUT /api/portal/assets/:id/interval). Spec:
// specs/calibration-interval-customer-owned/spec.md (REQ-ACCESS-INT-001..006).
// Only the portal better-auth getSession is mocked (test/integration/setup.ts);
// requirePortalAuth -> requireOrganization -> requirePortalAccess +
// requirePermission({equipment:["update"]}) + resolvePortalCustomerScope all run
// for real. The interval/periodicity is the customer's decision, not the lab's
// (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24).

const LOCAL_ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = { ...LOCAL_ORIGIN, "content-type": "application/json" };

async function ensureAssetType(): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Balança Digital",
      slug: "balanca-digital",
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!row) throw new Error("ensureAssetType: insert failed");
  return row.id;
}

async function seedAsset(params: {
  labUnitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
  lastCalibrationDate?: Date;
  nextCalibrationDate?: Date;
  metrologyRegime?: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.labUnitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: `Ativo ${params.tag}`,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
      lastCalibrationDate: params.lastCalibrationDate ?? null,
      nextCalibrationDate: params.nextCalibrationDate ?? null,
      metrologyRegime: params.metrologyRegime ?? "INDUSTRIAL",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

function put(assetId: number | string, body: unknown) {
  return portalRouter.request(`/assets/${assetId}/interval`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe("PUT /api/portal/assets/:id/interval — real DB + real portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-ACCESS-INT-001: in-scope + valid body → 200, persists interval +
  // provenance + derived next_calibration_date.
  it("REQ-ACCESS-INT-001: customer sets their own interval → 200 + persisted", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
      lastCalibrationDate: new Date(Date.UTC(2026, 0, 15)),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await put(assetId, {
      intervalMonths: 12,
      rationale: "Histórico estável; mantido em 12 meses.",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calibrationIntervalMonths).toBe(12);
    expect(body.intervalSetBy).toBe("customer_confirmed");

    const [row] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    expect(row?.calibrationIntervalMonths).toBe(12);
    expect(row?.intervalSetBy).toBe("customer_confirmed");
    expect(row?.intervalSetByUserId).toBe(ctx.portalUserId);
    expect(row?.intervalRationale).toBe(
      "Histórico estável; mantido em 12 meses.",
    );
    // Derived next-cal = last (2026-01-15) + 12 months = 2027-01-15.
    expect(row?.nextCalibrationDate?.toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  // REQ-INTERVAL-003 boundary: an interval on an asset with NO last-calibration
  // date derives nothing — and must NOT erase a pre-existing (grandfathered,
  // pre-flip lab-set) next date, or the asset silently drops out of the
  // due-calibration reminders the moment the customer sets an interval.
  it("keeps a grandfathered next date when the asset has no last-calibration date", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const grandfathered = new Date(Date.UTC(2026, 9, 1));
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-GRANDFATHER",
      nextCalibrationDate: grandfathered,
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await put(assetId, {
      intervalMonths: 12,
      rationale: "Primeira definição de periodicidade.",
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    expect(row?.calibrationIntervalMonths).toBe(12);
    expect(row?.nextCalibrationDate?.toISOString()).toBe(
      grandfathered.toISOString(),
    );
  });

  // REQ-ENGINE-APPLY-001: applying an engine suggestion (source="engine") records
  // interval_set_by='engine_applied'.
  it("REQ-ENGINE-APPLY-001: source=engine → interval_set_by=engine_applied", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-ENG",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await put(assetId, {
      intervalMonths: 18,
      rationale: "Sugestão do motor aplicada.",
      source: "engine",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).intervalSetBy).toBe("engine_applied");
    const [row] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    expect(row?.intervalSetBy).toBe("engine_applied");
  });

  // REQ-ACCESS-INT-004: the change writes an asset_audit_log row (old→new, user, rationale).
  it("REQ-ACCESS-INT-004: writes an asset_audit_log row with the rationale", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    await put(assetId, {
      intervalMonths: 6,
      rationale: "Encurtado: instrumento sensível.",
    });

    const logs = await db
      .select()
      .from(assetAuditLog)
      .where(eq(assetAuditLog.assetId, assetId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("interval_change");
    expect(logs[0]?.reason).toBe("Encurtado: instrumento sensível.");
    expect(logs[0]?.performedBy).toBe(ctx.portalUserId);
  });

  // REQ-ACCESS-INT-006: unauthenticated → 401 via the real requirePortalAuth.
  it("REQ-ACCESS-INT-006: unauthenticated → 401", async () => {
    logoutPortal();
    const res = await put(1, { intervalMonths: 12, rationale: "x" });
    expect(res.status).toBe(401);
  });

  // REQ-ACCESS-INT-002 [HIGH RISK]: an asset owned by ANOTHER customer → 404, no mutation.
  it("REQ-ACCESS-INT-002: another tenant's asset → 404 and is not mutated", async () => {
    const assetTypeId = await ensureAssetType();
    const ctxA = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "client-b",
      portalUserId: "user-b",
      customerName: "Customer B",
    });
    const bAssetId = await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      assetTypeId,
      tag: "EQ-B1",
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await put(bAssetId, {
      intervalMonths: 24,
      rationale: "tentativa",
    });

    expect(res.status).toBe(404);
    const [row] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, bAssetId))
      .limit(1);
    expect(row?.calibrationIntervalMonths).toBeNull();
  });

  // REQ-MLR-040 [HIGH RISK]: the customer owns the calibration interval for EVERY regime —
  // a legal-metrology asset is NOT locked; the interval is set. Its regulation-fixed
  // VERIFICATION periodicity is a separate, lab-recorded track (not this endpoint).
  it("REQ-MLR-040: legal-metrology asset → 200 and the interval is set", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-LM",
      metrologyRegime: "LEGAL",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await put(assetId, {
      intervalMonths: 24,
      rationale: "estender",
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    expect(row?.calibrationIntervalMonths).toBe(24);
  });

  // REQ-POLISH-003 [HIGH RISK]: hardens REQ-MLR-042 — the two tracks are INDEPENDENT. A
  // portal calibration-interval write touches Track 1 only; the lab-recorded Track-2 columns
  // (regulated_interval + next_legal_verification_date) are byte-unchanged. We compare a
  // DB-roundtrip taken right after the seed to a DB-roundtrip taken after the portal write,
  // so the assertion is exact regardless of timestamp/jsonb storage round-tripping.
  it("REQ-POLISH-003: portal interval write on a LEGAL asset leaves both Track-2 columns byte-unchanged", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-LM2",
      lastCalibrationDate: new Date(Date.UTC(2026, 0, 15)),
      metrologyRegime: "LEGAL",
    });

    // The lab records the legal regime + a regulation-fixed verification periodicity (Track 2)
    // plus an existing customer interval (Track 1).
    const seededRegulatedInterval = {
      kind: "fixed_months",
      valueMonths: 24,
      anchor: "last_verification",
      regulationReference: "Portaria Inmetro nº 124/2022",
      operationalizedByDelegate: false,
    };
    await db
      .update(asset)
      .set({
        metrologyRegime: "LEGAL",
        regulatedInterval: seededRegulatedInterval,
        nextLegalVerificationDate: new Date("2027-03-10T00:00:00.000Z"),
        calibrationIntervalMonths: 12,
        intervalSetBy: "customer_confirmed",
      })
      .where(eq(asset.id, assetId));

    const [before] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    expect(before?.calibrationIntervalMonths).toBe(12);
    expect(before?.regulatedInterval).toEqual(seededRegulatedInterval);
    expect(before?.nextLegalVerificationDate).toBeInstanceOf(Date);

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await put(assetId, {
      intervalMonths: 36,
      rationale: "estender por histórico estável",
    });
    expect(res.status).toBe(200);

    const [after] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);

    // Track 1 (customer-owned) changed to the new interval.
    expect(after?.calibrationIntervalMonths).toBe(36);
    expect(after?.calibrationIntervalMonths).not.toBe(
      before?.calibrationIntervalMonths,
    );

    // Track 2 (lab-recorded) is byte-unchanged — neither column was touched.
    expect(after?.regulatedInterval).toEqual(before?.regulatedInterval);
    expect(after?.nextLegalVerificationDate?.getTime()).toBe(
      before?.nextLegalVerificationDate?.getTime(),
    );
  });

  // REQ-ACCESS-INT-003 [HIGH RISK]: empty rationale → 400 (zValidator), no mutation.
  it("REQ-ACCESS-INT-003: empty rationale → 400", async () => {
    const assetTypeId = await ensureAssetType();
    const ctx = await seedPortalContext({
      labOrgId: "lab-1",
      clientOrgId: "client-a",
      portalUserId: "user-a",
      customerName: "Customer A",
    });
    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      tag: "EQ-A1",
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await put(assetId, { intervalMonths: 12, rationale: "   " });
    expect(res.status).toBe(400);
  });
});
