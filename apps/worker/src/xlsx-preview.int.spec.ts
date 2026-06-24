import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedPreview } from "../test/integration/seed-preview";

// Real-DB integration tier for the worker's XLSX certificate-template PREVIEW
// handler. processBackgroundJob({type:"CERTIFICATE_XLSX_PREVIEW",previewId,
// templateVersionId,userId}) routes (index.ts:3604) straight to
// processXlsxPreviewJob (index.ts:2666). We seed the template + version + the
// PENDING preview row via drizzle and invoke the PUBLIC `processBackgroundJob`
// (the queue entrypoint) directly, then assert the DB EFFECTS (the preview row's
// status transition + the persisted R2 keys/sha) by RE-QUERYING — never "it ran".
//
// STUBBING (only the render + R2 — NEVER the DB or the status logic):
//  * The XLSX engine + the XLSX->PDF converter live in
//    @calibra-facil/certificate-xlsx-template. The real converter shells out to
//    LibreOffice (LocalLibreOfficeXlsxToPdfConverter, used when GOTENBERG_URL is
//    unset — it is, in makeTestEnv), which is not available in-test. We vi.mock
//    ONLY the engine + both converter classes to return a fake workbook/PDF
//    buffer; we KEEP the real validateCertificateXlsxBindingManifest (the Zod
//    schema) via importOriginal so a malformed manifest still throws — not
//    over-mocked.
//  * R2 buckets are the in-memory fakes from makeTestEnv. The handler reads the
//    source XLSX from the MEDIA bucket (we `put` it) and writes the filled XLSX +
//    PDF preview to the CERTIFICATES bucket (TEMPLATE_PREVIEW -> "documents" ->
//    CERTIFICATES_BUCKET); we assert the puts.

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

// The preview handler (processXlsxPreviewJob) does NOT dispatch email, but the
// worker's index.ts statically imports notifyCertificateReady from
// @calibra-facil/notifications (index.ts:78), which transitively pulls the
// React-Email JSX templates into the module graph. The worker's node-only
// integration config has no JSX transform, so that import fails to parse. We mock
// the whole package to a no-op to sever that JSX import — exactly as the
// certificate-issuance spec does (there it also suppresses the real side effect;
// here it is purely to keep the import graph node-parseable).
vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => {}),
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

// ---- row-reader helpers (no `as`; same pattern as certificate-issuance spec) ----
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

async function previewRow(previewId: number) {
  const result = await db.execute(
    sql`SELECT status, filled_xlsx_r2_key, pdf_r2_key, pdf_sha256,
               render_metadata, error
        FROM certificate_template_preview WHERE id = ${previewId}`,
  );
  const row = toRows(result)[0];
  return {
    status: asString(field(row, "status")),
    filled_xlsx_r2_key: field(row, "filled_xlsx_r2_key"),
    pdf_r2_key: field(row, "pdf_r2_key"),
    pdf_sha256: field(row, "pdf_sha256"),
    render_metadata: field(row, "render_metadata"),
    error: field(row, "error"),
  };
}

// makeTestEnv's fake bucket keeps its Map private, so to assert which object keys
// were written we wrap CERTIFICATES_BUCKET.put and record each key while still
// delegating to the real fake (so the object remains readable).
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

/** Put a fake source XLSX into the env MEDIA bucket so getStoredObject finds it. */
async function putSourceXlsx(env: Env, xlsxR2Key: string) {
  await env.MEDIA_BUCKET.put(xlsxR2Key, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
    httpMetadata: {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processXlsxPreviewJob (worker real-DB integration)", () => {
  it("REQ-WPREV-001 [HIGH RISK] a PENDING preview is rendered: status -> RENDERED, pdf/xlsx R2 keys + sha persisted", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const preview = await seedPreview({
      organizationId: org.orgId,
      userId: org.userId,
    });
    await putSourceXlsx(env, preview.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE_XLSX_PREVIEW",
      previewId: preview.previewId,
      templateVersionId: preview.templateVersionId,
      userId: org.userId,
    });

    // Status transition PENDING -> RENDERED (re-queried from the DB).
    const after = await previewRow(preview.previewId);
    expect(after.status).toBe("RENDERED");

    // The preview R2 keys + hash are persisted (the success-path UPDATE,
    // index.ts:2779-2800). The keys point at the TEMPLATE_PREVIEW partition.
    expect(asString(after.pdf_r2_key)).toMatch(
      new RegExp(
        `^org/.*-${org.orgId}/certificate-template-previews/${preview.previewId}/preview\\.pdf$`,
      ),
    );
    expect(asString(after.filled_xlsx_r2_key)).toMatch(
      new RegExp(
        `^org/.*-${org.orgId}/certificate-template-previews/${preview.previewId}/preview\\.xlsx$`,
      ),
    );
    // pdf_sha256 is the hex hash of the fake PDF bytes the mocked converter gave.
    expect(asString(after.pdf_sha256)).toMatch(/^[0-9a-f]{64}$/);
    // error cleared on success.
    expect(after.error).toBeNull();

    // Both the filled XLSX and the PDF were written to the certificates bucket.
    expect(putKeys).toContain(asString(after.pdf_r2_key));
    expect(putKeys).toContain(asString(after.filled_xlsx_r2_key));
  });

  it("happy-path: a clean render persists render_metadata (converter + source/manifest sha + warnings)", async () => {
    const { env } = makeRecordingEnv();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const preview = await seedPreview({
      organizationId: org.orgId,
      userId: org.userId,
    });
    await putSourceXlsx(env, preview.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE_XLSX_PREVIEW",
      previewId: preview.previewId,
      templateVersionId: preview.templateVersionId,
      userId: org.userId,
    });

    const after = await previewRow(preview.previewId);
    expect(after.status).toBe("RENDERED");

    // render_metadata captures the documented fields (index.ts:2771-2777): the
    // version's source/manifest hashes, empty workbook warnings, and a duration.
    const metadata = after.render_metadata;
    expect(metadata && typeof metadata === "object").toBe(true);
    expect(field(metadata, "xlsxSha256")).toBe(preview.xlsxSha256);
    expect(field(metadata, "bindingManifestSha256")).toBe(
      preview.bindingManifestSha256,
    );
    expect(field(metadata, "workbookWarnings")).toEqual([]);
    expect(typeof field(metadata, "durationMs")).toBe("number");
    // The converter sub-object the fake returned is recorded verbatim.
    const converter = field(metadata, "converter");
    expect(field(converter, "engine")).toBe("local-libreoffice");
  });

  it("REQ-WPREV-002 tenant/org scope: rendering org-A's preview leaves org-B's PENDING preview untouched", async () => {
    const { env } = makeRecordingEnv();

    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const previewA = await seedPreview({
      organizationId: orgA.orgId,
      userId: orgA.userId,
      label: "alpha",
    });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    const previewB = await seedPreview({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      label: "beta",
    });
    await putSourceXlsx(env, previewA.xlsxR2Key);

    await processBackgroundJob(env, {
      type: "CERTIFICATE_XLSX_PREVIEW",
      previewId: previewA.previewId,
      templateVersionId: previewA.templateVersionId,
      userId: orgA.userId,
    });

    // org-A's preview was rendered; its keys carry org-A's partition, never B's.
    const afterA = await previewRow(previewA.previewId);
    expect(afterA.status).toBe("RENDERED");
    expect(asString(afterA.pdf_r2_key)).toContain("org-A");
    expect(asString(afterA.pdf_r2_key)).not.toContain("org-B");

    // org-B's preview is COMPLETELY untouched: still PENDING, no keys, no sha,
    // no metadata — rendering A never bled into B's tenant (the UPDATE is keyed
    // by id = $5, index.ts:2790).
    const afterB = await previewRow(previewB.previewId);
    expect(afterB.status).toBe("PENDING");
    expect(afterB.pdf_r2_key).toBeNull();
    expect(afterB.filled_xlsx_r2_key).toBeNull();
    expect(afterB.pdf_sha256).toBeNull();
    expect(afterB.render_metadata).toBeNull();
  });
});
