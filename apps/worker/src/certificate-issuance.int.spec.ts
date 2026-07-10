import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

// Real-DB integration tier for the worker's XLSX certificate-issuance handler.
// processBackgroundJob({type:"CERTIFICATE",jobId,userId}) routes through
// processDocumentMessage -> processJob -> processXlsxIssuedCertificate ->
// updateJobWithCertificate. We seed the full issuance graph via drizzle and
// invoke the PUBLIC `processBackgroundJob` (the queue entrypoint) directly, then
// assert the DB EFFECTS (job status transition, certificate_url, audit log,
// signature_verdict, issued snapshot) by RE-QUERYING — never "it ran".
//
// STUBBING (only the render + R2 + signing — NEVER the DB or the status logic):
//  * The XLSX engine + the XLSX->PDF converter live in
//    @calibra-facil/certificate-xlsx-template. The real converter shells out to
//    LibreOffice (LocalLibreOfficeXlsxToPdfConverter, used when GOTENBERG_URL is
//    unset — it is, in makeTestEnv), which is not available in-test. We vi.mock
//    ONLY the engine + both converter classes to return a fake workbook/PDF
//    buffer; we KEEP the real validateCertificateXlsxBindingManifest (the Zod
//    schema) via importActual so a malformed manifest still throws — not
//    over-mocked.
//  * R2 buckets are the in-memory fakes from makeTestEnv. The handler reads the
//    source XLSX from the MEDIA bucket (we `put` it) and writes the filled XLSX +
//    PDF to the CERTIFICATES bucket (we assert the puts).
//  * Signing no-ops because makeTestEnv OMITS SIGNING_MASTER_KEY (index.ts:1430):
//    signatureMetadata stays undefined and the at-issue verdict is not written.

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

// notifyCertificateReady is the email-dispatch side effect updateJobWithCertificate
// fires after the status write (index.ts:1409), already wrapped in try/catch so a
// failure never blocks issuance. It is NOT one of the DB effects under test (it
// writes portal notification rows, not the job/snapshot/audit rows we assert).
// We mock the whole package to a no-op: this also avoids dragging the React-Email
// JSX templates into the worker's node-only (no JSX transform) integration config.
vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => {}),
  notifyAuditPackReady: vi.fn(async () => {}),
}));

vi.mock("@calibra-facil/certificate-xlsx-template", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@calibra-facil/certificate-xlsx-template")
    >();

  // Fake engine: every fill step returns the workbook it was given (no real
  // OOXML mutation) with no warnings; insertImages is a passthrough.
  class FakeWorkbookEngine {
    async fillScalarsWithWarnings(source: Uint8Array) {
      return { workbook: source, warnings: [] };
    }
    async fillScalars(source: Uint8Array) {
      return { workbook: source, warnings: [] };
    }
    async fillTableRows(source: Uint8Array) {
      return { workbook: source, warnings: [] };
    }
    async insertImages(source: Uint8Array) {
      return source;
    }
  }

  // Fake converter: returns a deterministic fake PDF without touching LibreOffice.
  class FakeConverter {
    async convert(_input: Uint8Array, options?: unknown) {
      return {
        bytes: FAKE_PDF_BYTES,
        metadata: {
          engine: "local-libreoffice",
          options: options ?? {},
        },
      };
    }
  }

  return {
    ...actual,
    ExcelTsCertificateWorkbookEngine: FakeWorkbookEngine,
    GotenbergXlsxToPdfConverter: FakeConverter,
    LocalLibreOfficeXlsxToPdfConverter: FakeConverter,
  };
});

// vitest hoists vi.mock above the imports, so the worker's static import of the
// xlsx-template package resolves to the mocked engine/converters before index.ts
// evaluates. processBackgroundJob is the PUBLIC queue entrypoint (index.ts:3600).
import { processBackgroundJob } from "./index";

// ---- row-reader helpers (no `as`; same pattern as integrations.int.spec.ts) ----
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

async function jobRow(jobId: number) {
  const result = await db.execute(
    sql`SELECT status, certificate_url, signature_metadata, signature_verdict
        FROM calibration_job WHERE id = ${jobId}`,
  );
  const row = toRows(result)[0];
  return {
    status: asString(field(row, "status")),
    certificate_url: field(row, "certificate_url"),
    signature_metadata: field(row, "signature_metadata"),
    signature_verdict: field(row, "signature_verdict"),
  };
}

async function auditRows(jobId: number) {
  const result = await db.execute(
    sql`SELECT action, changes, performed_by
        FROM job_audit_log WHERE job_id = ${jobId} ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    action: asString(field(row, "action")),
    changes: field(row, "changes"),
    performed_by: asString(field(row, "performed_by")),
  }));
}

async function issuedSnapshotRows(jobId: number) {
  const result = await db.execute(
    sql`SELECT organization_id, job_id, pdf_r2_key, filled_xlsx_r2_key, status, issued_by, pdf_sha256
        FROM issued_certificate_snapshot WHERE job_id = ${jobId} ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    organization_id: asString(field(row, "organization_id")),
    pdf_r2_key: asString(field(row, "pdf_r2_key")),
    filled_xlsx_r2_key: asString(field(row, "filled_xlsx_r2_key")),
    status: asString(field(row, "status")),
    issued_by: asString(field(row, "issued_by")),
    pdf_sha256: asString(field(row, "pdf_sha256")),
  }));
}

// makeTestEnv's fake bucket keeps its Map private, so to assert which object
// keys were written we wrap CERTIFICATES_BUCKET.put and record each key while
// still delegating to the real fake (so the object remains readable).
function makeRecordingEnv(): { env: Env; putKeys: string[] } {
  const base = makeTestEnv();
  const putKeys: string[] = [];
  const certificates = base.CERTIFICATES_BUCKET;
  const recording: Env = {
    ...base,
    CERTIFICATES_BUCKET: {
      get: (key) => certificates.get(key),
      put: (key, body, options) => {
        putKeys.push(key);
        return certificates.put(key, body, options);
      },
    },
  };
  return { env: recording, putKeys };
}

const USER_ID = "user-org-1";

async function seedOrgAndJob(overrides?: {
  status?: Parameters<typeof seedIssuableJob>[0]["status"];
  jobNumber?: string;
  xlsxR2Key?: string;
}) {
  const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
    status: overrides?.status,
    jobNumber: overrides?.jobNumber,
    xlsxR2Key: overrides?.xlsxR2Key,
  });
  return { org, job };
}

/** Put a fake source XLSX into the env MEDIA bucket so getStoredObject finds it. */
async function putSourceXlsx(env: Env, xlsxR2Key: string) {
  await env.MEDIA_BUCKET.put(
    xlsxR2Key,
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    {
      httpMetadata: {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    },
  );
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processXlsxIssuedCertificate / updateJobWithCertificate (worker real-DB integration)", () => {
  it("REQ-WCERT-001 [HIGH RISK] a GENERATING_PDF job is issued: status -> APPROVED, certificate_url persisted, job_audit_log written", async () => {
    const { env } = makeRecordingEnv();
    const { org, job } = await seedOrgAndJob();
    await putSourceXlsx(env, job.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    // Status transition GENERATING_PDF -> APPROVED (re-queried from the DB).
    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");

    // certificate_url persisted, pointing at the issued snapshot's pdf key.
    expect(after.certificate_url).toBeTruthy();
    expect(asString(after.certificate_url)).toMatch(
      /^https:\/\/certificates\.calibrafacil\.com\//,
    );

    // A job_audit_log row was written for THIS issuance, by THIS user.
    const audit = await auditRows(job.jobId);
    const generated = audit.filter(
      (entry) => entry.action === "certificate_generated",
    );
    expect(generated).toHaveLength(1);
    expect(generated[0]?.performed_by).toBe(org.userId);
    // The audit row records the GENERATING_PDF -> APPROVED transition.
    const changes = generated[0]?.changes;
    const status =
      changes && typeof changes === "object"
        ? Reflect.get(changes, "status")
        : undefined;
    expect(
      status && typeof status === "object" ? Reflect.get(status, "new") : null,
    ).toBe("APPROVED");
  });

  it("happy-path: issuance persists the issued_certificate_snapshot (ISSUED) + writes filled-xlsx and pdf to R2", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const { org, job } = await seedOrgAndJob();
    await putSourceXlsx(env, job.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    // Exactly one issued_certificate_snapshot for this job, scoped to its org.
    const snapshots = await issuedSnapshotRows(job.jobId);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot?.organization_id).toBe(org.orgId);
    expect(snapshot?.status).toBe("ISSUED");
    expect(snapshot?.issued_by).toBe(org.userId);
    expect(snapshot?.pdf_r2_key).toBeTruthy();
    expect(snapshot?.filled_xlsx_r2_key).toBeTruthy();
    // pdf_sha256 is the hash of the fake PDF bytes the mocked converter returned.
    expect(snapshot?.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    // The certificate_url stored on the job points at the snapshot's pdf key.
    const after = await jobRow(job.jobId);
    expect(asString(after.certificate_url)).toContain(
      snapshot?.pdf_r2_key ?? "",
    );

    // Both the filled XLSX and the PDF were written to the certificates bucket.
    expect(putKeys).toContain(snapshot?.pdf_r2_key);
    expect(putKeys).toContain(snapshot?.filled_xlsx_r2_key);

    // Signing is omitted (no SIGNING_MASTER_KEY) -> no signature metadata/verdict.
    expect(after.signature_metadata).toBeNull();
    expect(after.signature_verdict).toBeNull();
  });

  it("REQ-WCERT-002 [HIGH RISK] a SUPERSEDED job is NOT re-approved by a stale issuance (index.ts:1361 guard)", async () => {
    const { env } = makeRecordingEnv();
    const { org, job } = await seedOrgAndJob({ status: "SUPERSEDED" });
    await putSourceXlsx(env, job.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    // The guard: status stays SUPERSEDED, NEVER clobbered to APPROVED.
    const after = await jobRow(job.jobId);
    expect(after.status).toBe("SUPERSEDED");

    // The audit row is the watermark variant, not certificate_generated.
    const audit = await auditRows(job.jobId);
    expect(
      audit.some((entry) => entry.action === "certificate_watermarked"),
    ).toBe(true);
    expect(
      audit.some((entry) => entry.action === "certificate_generated"),
    ).toBe(false);
  });

  it("REQ-WCERT-003 the issuance reads + writes only the job's own org's data (tenant scope)", async () => {
    const { env } = makeRecordingEnv();

    // org-A is fully seeded and issuable; org-B is a separate tenant whose job is
    // ALSO GENERATING_PDF but must be left untouched by org-A's issuance.
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const jobA = await seedIssuableJob({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      userId: orgA.userId,
      jobNumber: "CAL-A-0001",
      xlsxR2Key: "media/templates/CAL-A-0001.xlsx",
      customerName: "Cliente Alpha",
    });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    const jobB = await seedIssuableJob({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      userId: orgB.userId,
      jobNumber: "CAL-B-0001",
      xlsxR2Key: "media/templates/CAL-B-0001.xlsx",
      customerName: "Cliente Beta",
    });
    await putSourceXlsx(env, jobA.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: jobA.jobId,
      userId: orgA.userId,
    });

    // org-A's job was issued; the snapshot is scoped to org-A.
    const afterA = await jobRow(jobA.jobId);
    expect(afterA.status).toBe("APPROVED");
    const snapshotsA = await issuedSnapshotRows(jobA.jobId);
    expect(snapshotsA).toHaveLength(1);
    expect(snapshotsA[0]?.organization_id).toBe(orgA.orgId);
    // The pdf key embeds org-A's id partition, never org-B's.
    expect(snapshotsA[0]?.pdf_r2_key).toContain("org-A");
    expect(snapshotsA[0]?.pdf_r2_key).not.toContain("org-B");

    // org-B's job is COMPLETELY untouched: still GENERATING_PDF, no cert, no
    // audit, no snapshot — issuing A never bled into B's tenant.
    const afterB = await jobRow(jobB.jobId);
    expect(afterB.status).toBe("GENERATING_PDF");
    expect(afterB.certificate_url).toBeNull();
    expect(await auditRows(jobB.jobId)).toHaveLength(0);
    expect(await issuedSnapshotRows(jobB.jobId)).toHaveLength(0);
  });
});
