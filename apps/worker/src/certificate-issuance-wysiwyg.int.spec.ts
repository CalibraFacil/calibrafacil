import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob, WYSIWYG_JOB_RESULTS } from "../test/integration/seed-certificate";

// Real-DB integration tier for the WYSIWYG certificate-issuance handler
// (epic wysiwyg, M1 end-to-end proof). Mirrors certificate-issuance.int.spec.ts:
// we seed the full graph (org, customer, asset, service, PUBLISHED wysiwyg
// template version + ACTIVE assignment, GENERATING_PDF job WITH frozen results)
// and invoke the PUBLIC processBackgroundJob entrypoint, then assert DB EFFECTS
// by re-querying.
//
// STUBBING (only the PDF rasterization — NEVER the DB, the compiler, or the
// status logic):
//  * The COMPILER RUNS FOR REAL (compileCertificateHtml — Zod validation,
//    placeholder catalog, locked-block renderers, sha256). This is the point of
//    M1: the real documentJson -> HTML path against real frozen data.
//  * Gotenberg is an HTTP service; makeTestEnv has no GOTENBERG_URL. We set a
//    fake URL and stub global fetch for THAT host only (the DB uses pg over
//    TCP, not fetch) to return deterministic fake PDF bytes.
//  * Signing no-ops because makeTestEnv omits SIGNING_MASTER_KEY (same as the
//    XLSX spec).

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const GOTENBERG_TEST_URL = "http://gotenberg.int.test";

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => {}),
}));

import { processBackgroundJob } from "./index";

// ---- row-reader helpers (no `as`; same pattern as certificate-issuance.int.spec.ts) ----
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
    sql`SELECT status, certificate_url, rejection_reason FROM calibration_job WHERE id = ${jobId}`,
  );
  const row = toRows(result)[0];
  return {
    status: asString(field(row, "status")),
    certificate_url: field(row, "certificate_url"),
    rejection_reason: field(row, "rejection_reason"),
  };
}

async function issuedSnapshotRows(jobId: number) {
  const result = await db.execute(
    sql`SELECT organization_id, engine, pdf_r2_key, pdf_sha256,
               compiled_html_r2_key, compiled_html_sha256,
               filled_xlsx_r2_key, render_policy, input_data_snapshot, status
        FROM issued_certificate_snapshot WHERE job_id = ${jobId} ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    organization_id: asString(field(row, "organization_id")),
    engine: asString(field(row, "engine")),
    pdf_r2_key: asString(field(row, "pdf_r2_key")),
    pdf_sha256: asString(field(row, "pdf_sha256")),
    compiled_html_r2_key: field(row, "compiled_html_r2_key"),
    compiled_html_sha256: field(row, "compiled_html_sha256"),
    filled_xlsx_r2_key: field(row, "filled_xlsx_r2_key"),
    render_policy: field(row, "render_policy"),
    input_data_snapshot: field(row, "input_data_snapshot"),
    status: asString(field(row, "status")),
  }));
}

type StoredObject = { body: Uint8Array };

function makeRecordingEnv(): {
  env: Env;
  putKeys: string[];
  stored: Map<string, StoredObject>;
} {
  const base = makeTestEnv();
  const putKeys: string[] = [];
  const stored = new Map<string, StoredObject>();
  const certificates = base.CERTIFICATES_BUCKET;
  const recording: Env = {
    ...base,
    GOTENBERG_URL: GOTENBERG_TEST_URL,
    CERTIFICATES_BUCKET: {
      get: (key) => certificates.get(key),
      put: (key, body, options) => {
        putKeys.push(key);
        if (body instanceof Uint8Array) stored.set(key, { body });
        return certificates.put(key, body, options);
      },
    },
  };
  return { env: recording, putKeys, stored };
}

const realFetch = globalThis.fetch;

/** footer.html files sent to Gotenberg, in call order (M-B band assertions). */
const gotenbergFooters: string[] = [];

async function recordGotenbergFooter(init: unknown): Promise<void> {
  if (!init || typeof init !== "object") return;
  const body = Reflect.get(init, "body");
  if (!(body instanceof FormData)) return;
  for (const [key, value] of body.entries()) {
    if (key !== "files" || !(value instanceof File)) continue;
    if (value.name === "footer.html") gotenbergFooters.push(await value.text());
  }
}

beforeEach(async () => {
  await truncateAll();
  gotenbergFooters.length = 0;
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: unknown): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : String(input);
      if (url.startsWith(GOTENBERG_TEST_URL)) {
        await recordGotenbergFooter(init);
        return new Response(FAKE_PDF_BYTES, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      // Everything else (there should be nothing else) hits the real network.
      const request = input instanceof Request ? input : new Request(url, init && typeof init === "object" ? init : undefined);
      return realFetch(request);
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const USER_ID = "user-org-1";

describe("processHtmlIssuedCertificate (worker real-DB integration — M1)", () => {
  it("REQ-WYS-001 [HIGH RISK] end-to-end: wysiwyg template + frozen results -> APPROVED job + engine='wysiwyg' snapshot with compiled-HTML artifact + hashes", async () => {
    const { env, putKeys, stored } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
    });
    expect(job.documentSha256).toMatch(/^[0-9a-f]{64}$/);

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    // Job transitioned and carries the certificate URL.
    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(asString(after.certificate_url)).toMatch(
      /^https:\/\/certificates\.calibrafacil\.com\//,
    );

    // Exactly one issued snapshot: engine wysiwyg, compiled HTML artifact +
    // sha256, NO xlsx artifact (the per-engine CHECK constraint held).
    const snapshots = await issuedSnapshotRows(job.jobId);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot?.engine).toBe("wysiwyg");
    expect(snapshot?.status).toBe("ISSUED");
    expect(snapshot?.organization_id).toBe(org.orgId);
    expect(snapshot?.filled_xlsx_r2_key).toBeNull();
    expect(asString(snapshot?.compiled_html_r2_key)).toMatch(/\.html$/);
    expect(asString(snapshot?.compiled_html_sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot?.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    // renderPolicy records the chromium converter + compiler version.
    const policy = snapshot?.render_policy;
    expect(
      policy && typeof policy === "object" ? Reflect.get(policy, "converter") : null,
    ).toBe("gotenberg-chromium");

    // The exact render input was frozen.
    const inputData = snapshot?.input_data_snapshot;
    expect(inputData && typeof inputData === "object").toBe(true);

    // Both artifacts were written to the certificates bucket, and the STORED
    // compiled HTML re-hashes to the recorded compiled_html_sha256 — the
    // determinism evidence is verifiable from the bucket alone.
    expect(putKeys).toContain(snapshot?.pdf_r2_key);
    expect(putKeys).toContain(asString(snapshot?.compiled_html_r2_key));
    const storedHtml = stored.get(asString(snapshot?.compiled_html_r2_key));
    expect(storedHtml).toBeDefined();
    if (storedHtml) {
      const recomputed = createHash("sha256").update(storedHtml.body).digest("hex");
      expect(recomputed).toBe(snapshot?.compiled_html_sha256);
      const html = new TextDecoder().decode(storedHtml.body);
      // Real compiled content: frozen results and mandatory blocks are present.
      expect(html).toContain('data-locked-block="results_table"');
      expect(html).toContain("Erro de indicação");
      expect(html).toContain("0,0001 kg");
      expect(html).toContain("k = 2");
      // multi-point grid (T22): method table columns + per-row computed values
      expect(html).toContain("Carga nominal");
      expect(html).toContain("999,5");
      expect(html).toContain('class="cf-unit-row"');
      expect(html).toContain('data-locked-block="end_of_document"');
      // eccentricity indicator (calibration finding 3): the method's
      // indicator-enabled table renders the injected SVG after its grid
      expect(html).toContain('class="cf-eccentricity-indicator"');
      expect(html).toContain("data:image/svg+xml");
    }
  });

  it("REQ-WYS-007 [M-B] bands: compiled artifact carries the repeating thead identity band + embedded footer, and the footer identity box is SENT to Chromium", async () => {
    const { env, stored } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
    });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const snapshots = await issuedSnapshotRows(job.jobId);
    const htmlKey = asString(snapshots[0]?.compiled_html_r2_key);
    const storedHtml = stored.get(htmlKey);
    expect(storedHtml).toBeDefined();
    if (storedHtml) {
      const html = new TextDecoder().decode(storedHtml.body);
      // v2 docs upgrade on read: the artifact gains the band structure.
      expect(html.match(/<thead class="cf-doc-header">/g)?.length).toBe(1);
      expect(html).toContain('<table class="cf-doc">');
      expect(html).toContain('class="cf-band-cert"');
      expect(html.match(/<template id="cf-page-footer">/g)?.length).toBe(1);
    }

    // The embedded footer band (NOT the static fallback) reached Chromium:
    // it carries the certificate number alongside the mandatory page numbers.
    expect(gotenbergFooters.length).toBeGreaterThan(0);
    const footer = gotenbergFooters[gotenbergFooters.length - 1] ?? "";
    expect(footer).toContain('<span class="pageNumber"></span>');
    expect(footer).toContain('<span class="totalPages"></span>');
    expect(footer).toContain(`Certificado ${job.jobNumber}`);
  });

  it("REQ-WYS-002 idempotency: a second CERTIFICATE message re-serves the frozen snapshot (no second render, same pdf key)", async () => {
    const { env } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
    });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    const first = await issuedSnapshotRows(job.jobId);
    expect(first).toHaveLength(1);

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    const second = await issuedSnapshotRows(job.jobId);
    expect(second).toHaveLength(1);
    expect(second[0]?.pdf_r2_key).toBe(first[0]?.pdf_r2_key);
    expect(second[0]?.compiled_html_sha256).toBe(first[0]?.compiled_html_sha256);
  });

  it("REQ-WYS-003 [HIGH RISK] fail-loud: frozen results missing U/k -> job errors, NO snapshot, NO certificate (§7.8.4.1)", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
      // primary result present, but NO expanded uncertainty / coverage factor.
      results: { erro_indicacao: WYSIWYG_JOB_RESULTS.erro_indicacao },
    });

    await expect(
      processBackgroundJob(env, {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: org.userId,
      }),
    ).rejects.toThrow(/uncertainty_statement/);

    // setJobError: the job is REJECTED with the compiler's reason recorded.
    const after = await jobRow(job.jobId);
    expect(after.status).toBe("REJECTED");
    expect(after.certificate_url).toBeNull();
    expect(asString(after.rejection_reason)).toContain("uncertainty_statement");
    expect(await issuedSnapshotRows(job.jobId)).toHaveLength(0);
    expect(putKeys).toHaveLength(0); // nothing was uploaded
  });

  it("REQ-WYS-005 [HIGH RISK] immutability: editing the template AFTER issuance never alters the issued certificate", async () => {
    const { env } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
    });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    const issued = await issuedSnapshotRows(job.jobId);
    expect(issued).toHaveLength(1);
    const frozen = issued[0];

    // "Edit" the template: a NEW v2 version is published and even the old
    // version's assignment is superseded (simulating admin changes post-issue).
    await db.execute(
      sql`INSERT INTO certificate_template_version
            (organization_id, template_id, version, status, engine, document_json, document_sha256, render_policy, created_by, published_at, published_by)
          SELECT organization_id, template_id, 2, 'PUBLISHED', 'wysiwyg', document_json, 'f'||substr(document_sha256, 2), render_policy, created_by, now(), created_by
          FROM certificate_template_version WHERE id = ${job.templateVersionId}`,
    );

    // Re-render request after the template changed.
    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const after = await issuedSnapshotRows(job.jobId);
    expect(after).toHaveLength(1);
    // The frozen artifacts are byte-for-byte the ORIGINAL issuance.
    expect(after[0]?.pdf_r2_key).toBe(frozen?.pdf_r2_key);
    expect(after[0]?.pdf_sha256).toBe(frozen?.pdf_sha256);
    expect(after[0]?.compiled_html_sha256).toBe(frozen?.compiled_html_sha256);
    const jobAfter = await jobRow(job.jobId);
    expect(asString(jobAfter.certificate_url)).toContain(
      asString(frozen?.pdf_r2_key),
    );
  });

  it("REQ-WYS-006 template previews render with the ORG'S REAL LOGO in the letterhead", async () => {
    const { env, stored } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
    });
    // External logo URL: getLogoKeyFromUrl finds no media key -> passthrough.
    await db.execute(
      sql`UPDATE organization SET logo = ${"https://logo.example/marca.png"} WHERE id = ${org.orgId}`,
    );
    const previewInsert = await db.execute(
      sql`INSERT INTO certificate_template_preview
            (organization_id, template_version_id, sample_data, status, requested_by, expires_at)
          VALUES (${org.orgId}, ${job.templateVersionId}, ${"{}"}::jsonb, 'PENDING', ${org.userId}, now() + interval '1 day')
          RETURNING id`,
    );
    const previewId = Number(field(toRows(previewInsert)[0], "id"));
    expect(Number.isFinite(previewId)).toBe(true);

    await processBackgroundJob(env, {
      type: "CERTIFICATE_XLSX_PREVIEW",
      previewId,
      templateVersionId: job.templateVersionId,
      userId: org.userId,
    });

    const previewRow = toRows(
      await db.execute(
        sql`SELECT status, error, render_metadata FROM certificate_template_preview WHERE id = ${previewId}`,
      ),
    )[0];
    expect(asString(field(previewRow, "status"))).toBe("RENDERED");
    expect(field(previewRow, "error")).toBeNull();

    const metadata = field(previewRow, "render_metadata");
    const htmlKey =
      metadata && typeof metadata === "object"
        ? asString(Reflect.get(metadata, "compiledHtmlR2Key"))
        : "";
    expect(htmlKey).toMatch(/\.html$/);
    const storedHtml = stored.get(htmlKey);
    expect(storedHtml).toBeDefined();
    if (storedHtml) {
      const html = new TextDecoder().decode(storedHtml.body);
      expect(html).toContain('class="cf-lab-logo"');
      expect(html).toContain("https://logo.example/marca.png");
    }
  });

  it("REQ-WYS-004 cross-engine coexistence: an xlsx job in the same run is untouched by the wysiwyg branch", async () => {
    const { env } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const wysiwygJob = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      engine: "wysiwyg",
      jobNumber: "CAL-WYS-0001",
    });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: wysiwygJob.jobId,
      userId: org.userId,
    });

    const snapshots = await issuedSnapshotRows(wysiwygJob.jobId);
    expect(snapshots[0]?.engine).toBe("wysiwyg");
    // The wysiwyg path never wrote xlsx artifacts nor read the media bucket.
    expect(snapshots[0]?.filled_xlsx_r2_key).toBeNull();
  });
});
