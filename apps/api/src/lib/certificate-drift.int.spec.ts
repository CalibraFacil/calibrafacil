import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import {
  asset,
  assetType,
  calibrationJob,
  customer,
  issuedCertificateSnapshot,
  organizationEventLog,
  service,
} from "@calibra-facil/db/schema";

import { runCertificateDriftCheck } from "./certificate-drift";

// Real-DB integration for the drift-detection cron (roadmap item 6, epic
// backlog #1): seed a full issued-snapshot graph, then run the check with an
// injected artifact fetcher — intact bytes pass, tampered bytes and missing
// objects produce audit events. Regulated records are never mutated.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");

async function seedSnapshot(orgId: string, userId: string, unitId: number) {
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: "Cliente Drift",
      taxId: "11111111000111",
      authOrganizationId: orgId,
      labOrganizationId: orgId,
      createdAt: EPOCH,
    })
    .returning();
  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: "Balança Drift",
      slug: "balanca-drift",
      definition: [],
      createdAt: EPOCH,
    })
    .returning();
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId,
      customerId: customerRow!.id,
      labOrganizationId: orgId,
      assetTypeId: assetTypeRow!.id,
      name: "Balança",
      serialNumber: "SN-DRIFT",
      tag: "TAG-DRIFT",
      createdAt: EPOCH,
    })
    .returning();
  const [serviceRow] = await db
    .insert(service)
    .values({
      unitId,
      organizationId: orgId,
      name: "Calibração",
      createdAt: EPOCH,
    })
    .returning();
  const [jobRow] = await db
    .insert(calibrationJob)
    .values({
      jobId: "CAL-DRIFT-0001",
      certificateName: "CAL-DRIFT-0001",
      organizationId: orgId,
      unitId,
      customerId: customerRow!.id,
      assetId: assetRow!.id,
      serviceId: serviceRow!.id,
      methodSnapshot: {
        methodId: 0,
        methodName: "M",
        methodVersion: 1,
        accreditedScope: false,
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
      },
      status: "APPROVED",
      performedAt: EPOCH,
      createdBy: userId,
      createdAt: EPOCH,
    })
    .returning();
  const [snapshotRow] = await db
    .insert(issuedCertificateSnapshot)
    .values({
      organizationId: orgId,
      jobId: jobRow!.id,
      pdfR2Key: "certs/drift.pdf",
      pdfSha256: PDF_SHA,
      // #865 Phase 3: a snapshot describes a LAYOUT now, not a workbook. The
      // template link and the filled-XLSX columns went with migration 0108.
      renderPipeline: "FIXED_LAYOUT",
      layoutKey: "calibration-certificate-fixed",
      layoutVersion: "1.0.0",
      rendererVersion: "worker/1",
      renderPolicy: {
        converter: "gotenberg-chromium",
        layoutKey: "calibration-certificate-fixed",
        layoutVersion: "1.0.0",
      },
      inputDataSnapshot: {},
      status: "ISSUED",
    })
    .returning();
  return snapshotRow!;
}

async function auditRows(orgId: string) {
  return db
    .select({
      action: organizationEventLog.action,
      entityId: organizationEventLog.entityId,
      details: organizationEventLog.details,
    })
    .from(organizationEventLog)
    .where(
      and(
        eq(organizationEventLog.organizationId, orgId),
        eq(organizationEventLog.action, "certificate.drift_detected"),
      ),
    );
}

beforeEach(async () => {
  await truncateAll();
});

describe("runCertificateDriftCheck (real-DB integration)", () => {
  it("intact artifacts pass; tampered bytes and missing objects raise audit events", async () => {
    const org = await seedOrg({ orgId: "org-drift", userId: "user-drift" });
    const snapshot = await seedSnapshot(org.orgId, org.userId, org.unitId);

    // 1) intact
    const ok = await runCertificateDriftCheck(async () => PDF_BYTES);
    expect(ok.checked).toBeGreaterThan(0);
    expect(ok.drifted).toBe(0);
    expect(ok.missing).toBe(0);
    expect(await auditRows(org.orgId)).toHaveLength(0);

    // 2) tampered
    const tampered = await runCertificateDriftCheck(
      async () => new Uint8Array([9, 9, 9]),
    );
    expect(tampered.drifted).toBeGreaterThan(0);
    const afterTamper = await auditRows(org.orgId);
    expect(afterTamper.length).toBeGreaterThan(0);
    expect(afterTamper[0]?.entityId).toBe(String(snapshot.id));

    // 3) missing object
    const missing = await runCertificateDriftCheck(async () => null);
    expect(missing.missing).toBeGreaterThan(0);

    // regulated record untouched
    const row = await db.query.issuedCertificateSnapshot.findFirst({
      where: eq(issuedCertificateSnapshot.id, snapshot.id),
    });
    expect(row?.pdfSha256).toBe(PDF_SHA);
    expect(row?.status).toBe("ISSUED");
  });
});
