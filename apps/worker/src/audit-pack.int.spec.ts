import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import {
  seedApprovedCertificate,
  seedAuditPackExport,
  seedPortalCustomer,
} from "../test/integration/seed-audit-pack";

// Real-DB integration tier for the worker's AUDIT_PACK handler (#738).
// processBackgroundJob({type:"AUDIT_PACK",exportId,userId}) routes straight to
// processAuditPackJob. We seed the portal_export_job row + the certificate
// graph via drizzle, invoke the PUBLIC `processBackgroundJob` entrypoint, and
// assert the DB EFFECTS (export row status/columns) plus the actual ZIP bytes
// written to the fake R2 bucket (unzipped with fflate) — never "it ran".
//
// The tests deliberately request `fleetReport: false` in most cases: the
// fleet-report PDF renders through Gotenberg (GOTENBERG_URL is unset in
// makeTestEnv), and the gate/scope semantics under test are independent of it.

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

// The worker's index.ts statically imports the notification functions, which
// transitively pull React-Email JSX into the module graph; the node-only
// integration config has no JSX transform. Mock the package to sever the JSX
// import AND to keep the ready-notification a no-op side effect.
vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => {}),
  notifyAuditPackReady: vi.fn(async () => {}),
}));

import { processBackgroundJob } from "./index";
import { notifyAuditPackReady } from "@calibra-facil/notifications";

// ---- row-reader helpers (no `as`; same pattern as the sibling specs) ----
function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

async function exportRow(exportId: number) {
  const result = await db.execute(
    sql`SELECT status, certificate_count, included_job_ids, r2_key,
               file_size_bytes, failure_reason, expires_at, completed_at
        FROM portal_export_job WHERE id = ${exportId}`,
  );
  const row = toRows(result)[0];
  return {
    status: asString(field(row, "status")),
    certificate_count: field(row, "certificate_count"),
    included_job_ids: field(row, "included_job_ids"),
    r2_key: field(row, "r2_key"),
    file_size_bytes: field(row, "file_size_bytes"),
    failure_reason: field(row, "failure_reason"),
    expires_at: field(row, "expires_at"),
    completed_at: field(row, "completed_at"),
  };
}

/** Record every documents-bucket put so the test can find + unzip the pack. */
function makeRecordingEnv(): { env: Env; puts: Map<string, Uint8Array> } {
  const base = makeTestEnv();
  const puts = new Map<string, Uint8Array>();
  const certificates = base.CERTIFICATES_BUCKET;
  const recording: Env = {
    ...base,
    CERTIFICATES_BUCKET: {
      get: (key) => certificates.get(key),
      put: (key, body, options) => {
        const bytes =
          body instanceof Uint8Array
            ? body
            : body instanceof ArrayBuffer
              ? new Uint8Array(body)
              : new Uint8Array(body);
        puts.set(key, bytes);
        return certificates.put(key, body, options);
      },
    },
  };
  return { env: recording, puts };
}

function findZip(puts: Map<string, Uint8Array>): {
  key: string;
  entries: Record<string, Uint8Array>;
} {
  for (const [key, bytes] of puts) {
    if (key.endsWith(".zip")) {
      return { key, entries: unzipSync(bytes) };
    }
  }
  throw new Error("No ZIP was written to the documents bucket");
}

beforeEach(async () => {
  await truncateAll();
  vi.mocked(notifyAuditPackReady).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processAuditPackJob (worker real-DB integration)", () => {
  it("REQ-AUDIT-001 [HIGH RISK] builds the ZIP with only RELEASED certificates — a payment-held certificate never reaches the pack", async () => {
    const { env, puts } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const { customerId } = await seedPortalCustomer({
      organizationId: org.orgId,
    });

    const released = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0001",
      releaseStatus: "RELEASED",
    });
    // No release row at all -> defaults to RELEASED (legacy jobs).
    const legacy = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0002",
    });
    // Held for payment -> MUST be excluded from the ZIP and the index.
    const held = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0003",
      releaseStatus: "HELD_FOR_PAYMENT",
    });

    for (const cert of [released, legacy, held]) {
      await env.CERTIFICATES_BUCKET.put(cert.certificateR2Key, FAKE_PDF_BYTES, {
        httpMetadata: { contentType: "application/pdf" },
      });
    }

    const { exportId } = await seedAuditPackExport({
      organizationId: org.orgId,
      userId: org.userId,
      customerIds: [customerId],
    });

    await processBackgroundJob(env, {
      type: "AUDIT_PACK",
      exportId,
      userId: org.userId,
    });

    // Export row: COMPLETED with the released set only, expiry + size recorded.
    const after = await exportRow(exportId);
    expect(after.status).toBe("COMPLETED");
    expect(after.certificate_count).toBe(2);
    expect(after.included_job_ids).toEqual([released.jobId, legacy.jobId]);
    expect(after.failure_reason).toBeNull();
    expect(after.expires_at).not.toBeNull();
    expect(after.completed_at).not.toBeNull();
    expect(asString(after.r2_key)).toMatch(
      new RegExp(`^org/.*-${org.orgId}/portal-exports/${exportId}/.*\\.zip$`),
    );

    // The actual ZIP: two certificate PDFs, the index, the README — and NO
    // trace of the held certificate anywhere.
    const zip = findZip(puts);
    expect(zip.key).toBe(asString(after.r2_key));
    expect(Number(after.file_size_bytes)).toBeGreaterThan(0);

    const names = Object.keys(zip.entries);
    const pdfNames = names.filter((name) => name.startsWith("certificados/"));
    expect(pdfNames).toHaveLength(2);
    expect(pdfNames.join("\n")).toContain("CAL-2026-0001");
    expect(pdfNames.join("\n")).toContain("CAL-2026-0002");
    expect(pdfNames.join("\n")).not.toContain("CAL-2026-0003");
    expect(names).toContain("indice.html");
    expect(names).toContain("README.txt");

    const indexEntry = zip.entries["indice.html"];
    if (!indexEntry) throw new Error("indice.html missing from ZIP");
    const indexHtml = strFromU8(indexEntry);
    expect(indexHtml).toContain(`/v/${released.verificationToken}`);
    expect(indexHtml).toContain(`/v/${legacy.verificationToken}`);
    expect(indexHtml).not.toContain(held.verificationToken);
    expect(indexHtml).not.toContain("CAL-2026-0003");
  });

  it("REQ-AUDIT-002 tenant scope: another customer's certificates never enter the pack, even inside the window", async () => {
    const { env, puts } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const mine = await seedPortalCustomer({
      organizationId: org.orgId,
      name: "Cliente A",
    });
    const other = await seedPortalCustomer({
      organizationId: org.orgId,
      name: "Cliente B",
    });

    const myCert = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId: mine.customerId,
      jobNumber: "CAL-2026-1001",
      releaseStatus: "RELEASED",
    });
    const otherCert = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId: other.customerId,
      jobNumber: "CAL-2026-2001",
      releaseStatus: "RELEASED",
    });
    for (const cert of [myCert, otherCert]) {
      await env.CERTIFICATES_BUCKET.put(cert.certificateR2Key, FAKE_PDF_BYTES, {
        httpMetadata: { contentType: "application/pdf" },
      });
    }

    // The frozen scope only carries customer A.
    const { exportId } = await seedAuditPackExport({
      organizationId: org.orgId,
      userId: org.userId,
      customerIds: [mine.customerId],
    });

    await processBackgroundJob(env, {
      type: "AUDIT_PACK",
      exportId,
      userId: org.userId,
    });

    const after = await exportRow(exportId);
    expect(after.status).toBe("COMPLETED");
    expect(after.included_job_ids).toEqual([myCert.jobId]);

    const zip = findZip(puts);
    const names = Object.keys(zip.entries).join("\n");
    expect(names).toContain("CAL-2026-1001");
    expect(names).not.toContain("CAL-2026-2001");
  });

  it("REQ-AUDIT-003 date window: certificates approved outside the requested period are excluded", async () => {
    const { env, puts } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const { customerId } = await seedPortalCustomer({
      organizationId: org.orgId,
    });

    const inWindow = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0100",
      approvedAt: new Date("2026-06-15T12:00:00.000Z"),
      releaseStatus: "RELEASED",
    });
    const outOfWindow = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2025-0099",
      approvedAt: new Date("2025-06-15T12:00:00.000Z"),
      releaseStatus: "RELEASED",
    });
    for (const cert of [inWindow, outOfWindow]) {
      await env.CERTIFICATES_BUCKET.put(cert.certificateR2Key, FAKE_PDF_BYTES, {
        httpMetadata: { contentType: "application/pdf" },
      });
    }

    const { exportId } = await seedAuditPackExport({
      organizationId: org.orgId,
      userId: org.userId,
      customerIds: [customerId],
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });

    await processBackgroundJob(env, {
      type: "AUDIT_PACK",
      exportId,
      userId: org.userId,
    });

    const after = await exportRow(exportId);
    expect(after.status).toBe("COMPLETED");
    expect(after.included_job_ids).toEqual([inWindow.jobId]);

    const zip = findZip(puts);
    const names = Object.keys(zip.entries).join("\n");
    expect(names).toContain("CAL-2026-0100");
    expect(names).not.toContain("CAL-2025-0099");
  });

  it("REQ-AUDIT-004 completion dispatches the ready notification for the export", async () => {
    const { env } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const { customerId } = await seedPortalCustomer({
      organizationId: org.orgId,
    });
    const cert = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0001",
      releaseStatus: "RELEASED",
    });
    await env.CERTIFICATES_BUCKET.put(cert.certificateR2Key, FAKE_PDF_BYTES, {
      httpMetadata: { contentType: "application/pdf" },
    });
    const { exportId } = await seedAuditPackExport({
      organizationId: org.orgId,
      userId: org.userId,
      customerIds: [customerId],
    });

    await processBackgroundJob(env, {
      type: "AUDIT_PACK",
      exportId,
      userId: org.userId,
    });

    expect(vi.mocked(notifyAuditPackReady)).toHaveBeenCalledWith(exportId);
  });

  it("REQ-AUDIT-005 failure path: an invalid export records FAILED + failure_reason and rethrows for the queue retry", async () => {
    const { env } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const { customerId } = await seedPortalCustomer({
      organizationId: org.orgId,
    });

    // A certificate whose PDF bytes were never uploaded is SKIPPED (not fatal),
    // so to exercise the failure path we corrupt the params: an empty
    // customerIds array fails parseAuditPackParams.
    const { exportId } = await seedAuditPackExport({
      organizationId: org.orgId,
      userId: org.userId,
      customerIds: [customerId],
    });
    await db.execute(
      sql`UPDATE portal_export_job
          SET params = jsonb_set(params, '{customerIds}', '[]'::jsonb)
          WHERE id = ${exportId}`,
    );

    await expect(
      processBackgroundJob(env, {
        type: "AUDIT_PACK",
        exportId,
        userId: org.userId,
      }),
    ).rejects.toThrow("Invalid audit pack params");

    const after = await exportRow(exportId);
    expect(after.status).toBe("FAILED");
    expect(asString(after.failure_reason)).toContain(
      "Invalid audit pack params",
    );
    expect(after.r2_key).toBeNull();
    expect(vi.mocked(notifyAuditPackReady)).not.toHaveBeenCalled();
  });

  it("REQ-AUDIT-006 a certificate missing from R2 is skipped with a README note, not a failed pack", async () => {
    const { env, puts } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const { customerId } = await seedPortalCustomer({
      organizationId: org.orgId,
    });

    const present = await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0001",
      releaseStatus: "RELEASED",
    });
    // Seeded in the DB, but its PDF is never uploaded to the fake bucket.
    await seedApprovedCertificate({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      customerId,
      jobNumber: "CAL-2026-0002",
      releaseStatus: "RELEASED",
    });
    await env.CERTIFICATES_BUCKET.put(
      present.certificateR2Key,
      FAKE_PDF_BYTES,
      {
        httpMetadata: { contentType: "application/pdf" },
      },
    );

    const { exportId } = await seedAuditPackExport({
      organizationId: org.orgId,
      userId: org.userId,
      customerIds: [customerId],
    });

    await processBackgroundJob(env, {
      type: "AUDIT_PACK",
      exportId,
      userId: org.userId,
    });

    const after = await exportRow(exportId);
    expect(after.status).toBe("COMPLETED");
    expect(after.certificate_count).toBe(1);
    expect(after.included_job_ids).toEqual([present.jobId]);

    const zip = findZip(puts);
    const readmeEntry = zip.entries["README.txt"];
    if (!readmeEntry) throw new Error("README.txt missing from ZIP");
    const readme = strFromU8(readmeEntry);
    expect(readme).toContain(
      "1 certificado(s) do período não puderam ser incluídos",
    );
  });
});
