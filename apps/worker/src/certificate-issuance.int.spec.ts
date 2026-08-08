import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * Real-DB integration tier for the fixed-layout certificate issuance (#865
 * Phase 3). `processBackgroundJob({type:"CERTIFICATE",...})` routes through
 * processDocumentMessage → processJob, which fetches the frozen job, builds the
 * layout prop, renders through Gotenberg, signs, stores and records.
 *
 * We seed the graph via drizzle, invoke the PUBLIC queue entrypoint, and assert
 * DB EFFECTS by RE-QUERYING — never "it ran".
 *
 * STUBBED (the network and nothing else):
 *  * Gotenberg. `global.fetch` is replaced for the conversion URL only, so the
 *    REAL React layout still renders to HTML and the REAL adapter still builds
 *    the prop from the seeded method — only the HTML→PDF hop is faked. A method
 *    that declares too little to render still fails here, which is the point.
 *  * R2 is the in-memory fake from makeTestEnv.
 *  * Signing no-ops because makeTestEnv omits SIGNING_MASTER_KEY, so
 *    signature_metadata stays NULL and no at-issue verdict is written.
 *
 * The DB, the status transitions, the audit trail and the write-once snapshot
 * insert are all real.
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "./index";

const GOTENBERG_URL = "http://gotenberg.test";
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

/** Every Gotenberg request the run made, so the geometry can be asserted. */
type CapturedRender = { url: string; files: string[] };

function stubGotenberg(captured: CapturedRender[]) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(GOTENBERG_URL)) {
      return realFetch(input, init);
    }
    const body = init?.body;
    const files =
      body instanceof FormData
        ? body
            .getAll("files")
            .map((entry) => (entry instanceof File ? entry.name : "blob"))
        : [];
    captured.push({ url, files });
    return new Response(FAKE_PDF_BYTES, { status: 200 });
  });
}

// ---- row readers (no `as`; same pattern as integrations.int.spec.ts) ----
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
    sql`SELECT status, certificate_url, signature_metadata, signature_verdict,
               rejection_reason
        FROM calibration_job WHERE id = ${jobId}`,
  );
  const row = toRows(result)[0];
  return {
    status: asString(field(row, "status")),
    certificate_url: field(row, "certificate_url"),
    signature_metadata: field(row, "signature_metadata"),
    signature_verdict: field(row, "signature_verdict"),
    rejection_reason: field(row, "rejection_reason"),
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
    sql`SELECT organization_id, pdf_r2_key, pdf_sha256, status, issued_by,
               render_pipeline, layout_key, layout_version, renderer_version,
               certificate_number
        FROM issued_certificate_snapshot WHERE job_id = ${jobId} ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    organization_id: asString(field(row, "organization_id")),
    pdf_r2_key: asString(field(row, "pdf_r2_key")),
    pdf_sha256: asString(field(row, "pdf_sha256")),
    status: asString(field(row, "status")),
    issued_by: asString(field(row, "issued_by")),
    render_pipeline: asString(field(row, "render_pipeline")),
    layout_key: asString(field(row, "layout_key")),
    layout_version: asString(field(row, "layout_version")),
    renderer_version: asString(field(row, "renderer_version")),
    certificate_number: asString(field(row, "certificate_number")),
  }));
}

/**
 * makeTestEnv's fake bucket keeps its Map private, so to assert which keys were
 * written we wrap put() and record, still delegating so the object stays
 * readable. GOTENBERG_URL is set here because the fixed layout renders through
 * Chromium — the XLSX path used to fall back to a local LibreOffice.
 */
function makeRecordingEnv(): { env: Env; putKeys: string[] } {
  const base = makeTestEnv();
  const putKeys: string[] = [];
  const certificates = base.CERTIFICATES_BUCKET;
  const env: Env = {
    ...base,
    GOTENBERG_URL,
    CERTIFICATES_BUCKET: {
      ...certificates,
      put: async (key, value, options) => {
        putKeys.push(key);
        return certificates.put(key, value, options);
      },
    },
  };
  return { env, putKeys };
}

const USER_ID = "user-org-1";

async function seedOrgAndJob(overrides?: {
  status?: Parameters<typeof seedIssuableJob>[0]["status"];
  jobNumber?: string;
  withoutReportedUncertainty?: boolean;
}) {
  const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
    ...overrides,
  });
  return { org, job };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixed-layout certificate issuance (worker real-DB integration)", () => {
  it("REQ-WCERT-001 [HIGH RISK] a GENERATING_PDF job is issued: status -> APPROVED, certificate_url persisted, job_audit_log written", async () => {
    const { env } = makeRecordingEnv();
    stubGotenberg([]);
    const { org, job } = await seedOrgAndJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(asString(after.certificate_url)).toMatch(
      /^https:\/\/certificates\.calibrafacil\.com\//,
    );

    const generated = (await auditRows(job.jobId)).filter(
      (entry) => entry.action === "certificate_generated",
    );
    expect(generated).toHaveLength(1);
    expect(generated[0]?.performed_by).toBe(org.userId);
    const changes = generated[0]?.changes;
    const status =
      changes && typeof changes === "object"
        ? Reflect.get(changes, "status")
        : undefined;
    expect(
      status && typeof status === "object" ? Reflect.get(status, "new") : null,
    ).toBe("APPROVED");
  });

  it("happy-path: persists the issued snapshot as FIXED_LAYOUT with its layout identity, and writes the PDF to R2", async () => {
    const { env, putKeys } = makeRecordingEnv();
    stubGotenberg([]);
    const { org, job } = await seedOrgAndJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const snapshots = await issuedSnapshotRows(job.jobId);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot?.organization_id).toBe(org.orgId);
    expect(snapshot?.status).toBe("ISSUED");
    expect(snapshot?.issued_by).toBe(org.userId);
    expect(snapshot?.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    // Reproducibility (§7.8 / Phase 3): the row must say WHICH renderer made
    // it, or a byte difference years from now cannot be told from tampering.
    expect(snapshot?.render_pipeline).toBe("FIXED_LAYOUT");
    expect(snapshot?.layout_key).toBeTruthy();
    expect(snapshot?.layout_version).toBeTruthy();
    expect(snapshot?.renderer_version).toBeTruthy();

    expect(putKeys).toContain(snapshot?.pdf_r2_key);
    // No filled workbook any more — the XLSX sibling is gone with the pipeline.
    expect(putKeys.filter((key) => key.endsWith(".xlsx"))).toEqual([]);

    const after = await jobRow(job.jobId);
    expect(asString(after.certificate_url)).toContain(
      snapshot?.pdf_r2_key ?? "",
    );
    // No SIGNING_MASTER_KEY in the test env, so issuance emits unsigned.
    expect(after.signature_metadata).toBeNull();
    expect(after.signature_verdict).toBeNull();
  });

  it("renders through the certificate branch, with both running templates", async () => {
    const captured: CapturedRender[] = [];
    const { env } = makeRecordingEnv();
    stubGotenberg(captured);
    const { org, job } = await seedOrgAndJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain("/forms/chromium/convert/html");
    // §7.8.2.1(d) and NIE-Cgcre-009 §11.5.2 both ride on the running header:
    // without these two files continuation pages lose their identity.
    expect(captured[0]?.files).toContain("header.html");
    expect(captured[0]?.files).toContain("footer.html");
  });

  it("REQ-WCERT-002 [HIGH RISK] a SUPERSEDED job is NOT re-approved by a stale issuance", async () => {
    const { env } = makeRecordingEnv();
    stubGotenberg([]);
    const { org, job } = await seedOrgAndJob({ status: "SUPERSEDED" });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("SUPERSEDED");
    const actions = (await auditRows(job.jobId)).map((entry) => entry.action);
    expect(actions).toContain("certificate_watermarked");
    expect(actions).not.toContain("certificate_generated");
  });

  it("REQ-WCERT-003 the issuance reads and writes only the job's own org's data (tenant scope)", async () => {
    const { env } = makeRecordingEnv();
    stubGotenberg([]);
    const { org, job } = await seedOrgAndJob();
    const otherOrg = await seedOrg({ orgId: "org-2", userId: "user-org-2" });
    const otherJob = await seedIssuableJob({
      organizationId: otherOrg.orgId,
      unitId: otherOrg.unitId,
      userId: otherOrg.userId,
      jobNumber: "CAL-2026-0002",
    });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    // The other tenant's job is untouched: no snapshot, no transition.
    expect(await issuedSnapshotRows(otherJob.jobId)).toHaveLength(0);
    expect((await jobRow(otherJob.jobId)).status).toBe("GENERATING_PDF");
    const snapshot = (await issuedSnapshotRows(job.jobId))[0];
    expect(snapshot?.organization_id).toBe(org.orgId);
  });

  // REQ-REL-PDF-002: the write-once guarantee. This is the one failure the
  // whole path must not have — a re-delivered queue message minting a second
  // certificate number for a job that already has one.
  it("REQ-REL-PDF-002 re-driving an already-issued job never mints a second certificate", async () => {
    const { env } = makeRecordingEnv();
    stubGotenberg([]);
    const { org, job } = await seedOrgAndJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    const first = (await issuedSnapshotRows(job.jobId))[0];

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const snapshots = await issuedSnapshotRows(job.jobId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.pdf_r2_key).toBe(first?.pdf_r2_key);
    expect(snapshots[0]?.certificate_number).toBe(first?.certificate_number);
    expect((await jobRow(job.jobId)).status).toBe("APPROVED");
  });

  // The replacement for REQ-MTPL-001/002/003. Per-lab template resolution is
  // gone; what must fail loud now is a method that does not declare enough for
  // a correct results table. A guessed table is worse than a blocked issuance.
  it("refuses to issue when the method declares no reported uncertainty", async () => {
    const { env } = makeRecordingEnv();
    stubGotenberg([]);
    const { org, job } = await seedOrgAndJob({
      withoutReportedUncertainty: true,
    });

    await expect(
      processBackgroundJob(env, {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: org.userId,
      }),
    ).rejects.toThrow();

    // Nothing was issued, and the job is REJECTED with the reason recorded —
    // not left stranded in GENERATING_PDF, which is the state this whole guard
    // exists to avoid. The operator has to be able to read WHY.
    expect(await issuedSnapshotRows(job.jobId)).toHaveLength(0);
    const after = await jobRow(job.jobId);
    expect(after.status).toBe("REJECTED");
    expect(asString(after.rejection_reason)).toContain("expanded_uncertainty");
  });
});
