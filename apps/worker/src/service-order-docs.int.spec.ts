import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import {
  seedDeliveryDocument,
  seedIntakeDocument,
  seedQuote,
  seedServiceOrder,
  seedTag,
} from "../test/integration/seed-service-order";

// Real-DB integration tier for the worker's SERVICE_ORDER document handlers.
// processBackgroundJob({type:"SERVICE_ORDER_INTAKE_DOCUMENT" | "_TAG" | "_QUOTE"
// | "_DELIVERY_RECEIPT", serviceOrderId, userId, ...}) routes through
// processDocumentMessage (index.ts:2546) -> the per-type handler
// (index.ts:1799/1871/1954/2038). Each handler:
//   READS  an org-scoped service_order + its customer/asset snapshot + the lab
//          organization (fetchServiceOrderDocumentData index.ts:1641 / inline
//          SQL), resolving the org from the SO's OWN organization_id
//          (fetchServiceOrderOrg index.ts:1853 / fetchOrgRefById index.ts:401).
//   RENDERS an HTML document (renderToString of the @calibra-facil/documents
//          ServiceOrder*Html component) and converts it to a PDF via Gotenberg
//          (generatePdfFromHtml -> gotenbergHtmlToPdf -> global `fetch`,
//          index.ts:2348).
//   WRITES the PDF to R2 under an ORG-PARTITIONED key (serviceOrderDocKey ->
//          org/<slug-id>/<year>/<month>/...), then persists that pdf_r2_key
//          (plus issued_at/printed_at + the acting user) onto the relevant
//          document/tag/quote row.
//
// The DB-assertable surface IS real (not just an R2 put): each handler writes
// pdf_r2_key + timestamps + the acting user back onto a DB row. We assert those
// writes AND that the org-partitioned key embeds the SO's own org.
//
// STUBBING (only the PDF converter — NEVER the DB, the data resolution, or the
// render):
//  * gotenbergHtmlToPdf POSTs the rendered HTML to a Gotenberg service via the
//    global `fetch`. There is no Gotenberg in-test, so we stub `globalThis.fetch`
//    to RECORD the rendered HTML body and return a fake PDF response. This keeps
//    the REAL data resolution + REAL React-to-HTML render in the loop — so the
//    captured HTML is the genuine rendered payload, which is exactly what the
//    cross-tenant assertion inspects (org-A's customer/asset/SO-number appear;
//    org-B's never do).
//  * R2 buckets are the in-memory fakes from makeTestEnv; SERVICE_ORDER_DOC keys
//    map to the "documents" bucket -> env.CERTIFICATES_BUCKET. We wrap its `put`
//    to record the written keys.
//  * GOTENBERG_URL is set via makeTestEnv overrides so requireGotenbergUrl
//    (index.ts:2341) does not throw before the stubbed fetch is reached.

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

// The SO handlers do not call notifyCertificateReady, but importing ./index pulls
// the whole worker module graph (incl. the certificate path that does). Mock the
// package to a no-op so the worker's node-only integration config never has to
// transform the React-Email JSX templates that package transitively imports.
vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => {}),
}));

// vitest hoists vi.mock above the imports. processBackgroundJob is the PUBLIC
// queue entrypoint (index.ts:3600).
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

async function intakeDocRow(documentId: number) {
  const result = await db.execute(
    sql`SELECT pdf_r2_key, issued_at, issued_by_user_id
        FROM service_order_intake_document WHERE id = ${documentId}`,
  );
  const row = toRows(result)[0];
  return {
    pdf_r2_key: field(row, "pdf_r2_key"),
    issued_at: field(row, "issued_at"),
    issued_by_user_id: field(row, "issued_by_user_id"),
  };
}

async function tagRow(tagId: number) {
  const result = await db.execute(
    sql`SELECT pdf_r2_key, printed_at, printed_by_user_id
        FROM service_order_tag WHERE id = ${tagId}`,
  );
  const row = toRows(result)[0];
  return {
    pdf_r2_key: field(row, "pdf_r2_key"),
    printed_at: field(row, "printed_at"),
    printed_by_user_id: field(row, "printed_by_user_id"),
  };
}

async function quoteRow(quoteId: number) {
  const result = await db.execute(
    sql`SELECT pdf_r2_key FROM service_order_quote WHERE id = ${quoteId}`,
  );
  const row = toRows(result)[0];
  return { pdf_r2_key: field(row, "pdf_r2_key") };
}

async function deliveryDocRow(documentId: number) {
  const result = await db.execute(
    sql`SELECT pdf_r2_key, issued_at, issued_by_user_id
        FROM service_order_delivery_document WHERE id = ${documentId}`,
  );
  const row = toRows(result)[0];
  return {
    pdf_r2_key: field(row, "pdf_r2_key"),
    issued_at: field(row, "issued_at"),
    issued_by_user_id: field(row, "issued_by_user_id"),
  };
}

// Stub globalThis.fetch: record each rendered HTML body, return a fake PDF. The
// handler reads only `response.ok` + `response.arrayBuffer()`. We capture the
// HTML so the cross-tenant test can inspect the genuine rendered payload.
function installFetchRecorder(): { htmlBodies: string[] } {
  const htmlBodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = init?.body;
    if (body instanceof FormData) {
      const filePart = body.get("files");
      if (filePart instanceof Blob) {
        htmlBodies.push(await filePart.text());
      }
    }
    const buffer = new ArrayBuffer(FAKE_PDF_BYTES.byteLength);
    new Uint8Array(buffer).set(FAKE_PDF_BYTES);
    return new Response(buffer, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  });
  return { htmlBodies };
}

// makeTestEnv's fake bucket keeps its Map private; wrap CERTIFICATES_BUCKET.put
// (SERVICE_ORDER_DOC -> "documents" -> CERTIFICATES_BUCKET) to record the keys
// while still delegating to the real fake. Also set GOTENBERG_URL.
function makeRecordingEnv(): { env: Env; putKeys: string[] } {
  const base = makeTestEnv({ GOTENBERG_URL: "http://gotenberg.test" });
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

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processDocumentMessage / SERVICE_ORDER_* handlers (worker real-DB integration)", () => {
  it("happy-path INTAKE: renders the SO's own data + persists pdf_r2_key/issued_at/issued_by", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const { htmlBodies } = installFetchRecorder();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const so = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-2026-0001",
      customerName: "Cliente Intake",
      assetName: "Balança Intake",
    });
    const intake = await seedIntakeDocument({
      serviceOrderId: so.serviceOrderId,
      serviceOrderNumber: so.serviceOrderNumber,
    });

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_INTAKE_DOCUMENT",
      serviceOrderId: so.serviceOrderId,
      documentId: intake.documentId,
      userId: org.userId,
    });

    // DB effect: the intake document row now carries the pdf key + issuance stamp.
    const after = await intakeDocRow(intake.documentId);
    expect(after.pdf_r2_key).toBeTruthy();
    expect(after.issued_at).toBeTruthy();
    expect(after.issued_by_user_id).toBe(org.userId);

    // The persisted key is org-partitioned and matches what was put to R2.
    const key = asString(after.pdf_r2_key);
    expect(key).toContain(`org/${org.orgId}-${org.orgId}/`); // slug-id partition
    expect(key).toContain("/2026/01/");
    expect(key).toMatch(/intake-v\d+\.pdf$/);
    expect(putKeys).toContain(key);

    // The rendered HTML is the SO's own data (proves render ran, not a stub echo).
    expect(htmlBodies).toHaveLength(1);
    expect(htmlBodies[0]).toContain("Cliente Intake");
    expect(htmlBodies[0]).toContain("Balança Intake");
    expect(htmlBodies[0]).toContain("OS-2026-0001");
  });

  it("happy-path TAG: persists pdf_r2_key/printed_at/printed_by on the tag", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const { htmlBodies } = installFetchRecorder();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const so = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-2026-0002",
      customerName: "Cliente Tag",
      assetName: "Balança Tag",
    });
    const tag = await seedTag({
      serviceOrderId: so.serviceOrderId,
      serviceOrderNumber: so.serviceOrderNumber,
    });

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_TAG",
      serviceOrderId: so.serviceOrderId,
      tagId: tag.tagId,
      userId: org.userId,
    });

    const after = await tagRow(tag.tagId);
    expect(after.pdf_r2_key).toBeTruthy();
    expect(after.printed_at).toBeTruthy();
    expect(after.printed_by_user_id).toBe(org.userId);

    const key = asString(after.pdf_r2_key);
    expect(key).toContain(`org/${org.orgId}-${org.orgId}/`);
    expect(key).toMatch(/tag-.*\.pdf$/);
    expect(putKeys).toContain(key);

    expect(htmlBodies[0]).toContain("Cliente Tag");
    expect(htmlBodies[0]).toContain("Balança Tag");
  });

  it("happy-path QUOTE: persists pdf_r2_key on the quote", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const { htmlBodies } = installFetchRecorder();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const so = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-2026-0003",
      customerName: "Cliente Quote",
      assetName: "Balança Quote",
    });
    const quote = await seedQuote({
      serviceOrderId: so.serviceOrderId,
      serviceOrderNumber: so.serviceOrderNumber,
      userId: org.userId,
    });

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_QUOTE",
      serviceOrderId: so.serviceOrderId,
      quoteId: quote.quoteId,
      userId: org.userId,
    });

    const after = await quoteRow(quote.quoteId);
    expect(after.pdf_r2_key).toBeTruthy();
    const key = asString(after.pdf_r2_key);
    expect(key).toContain(`org/${org.orgId}-${org.orgId}/`);
    expect(key).toMatch(/quotes\/.*-v\d+\.pdf$/);
    expect(putKeys).toContain(key);

    expect(htmlBodies[0]).toContain("Cliente Quote");
  });

  it("happy-path DELIVERY: persists pdf_r2_key/issued_at/issued_by on the delivery document", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const { htmlBodies } = installFetchRecorder();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const so = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-2026-0004",
      customerName: "Cliente Delivery",
      assetName: "Balança Delivery",
    });
    const delivery = await seedDeliveryDocument({
      serviceOrderId: so.serviceOrderId,
      serviceOrderNumber: so.serviceOrderNumber,
      userId: org.userId,
    });

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_DELIVERY_RECEIPT",
      serviceOrderId: so.serviceOrderId,
      documentId: delivery.documentId,
      userId: org.userId,
    });

    const after = await deliveryDocRow(delivery.documentId);
    expect(after.pdf_r2_key).toBeTruthy();
    expect(after.issued_at).toBeTruthy();
    expect(after.issued_by_user_id).toBe(org.userId);

    const key = asString(after.pdf_r2_key);
    expect(key).toContain(`org/${org.orgId}-${org.orgId}/`);
    expect(key).toMatch(/delivery-v\d+\.pdf$/);
    expect(putKeys).toContain(key);

    expect(htmlBodies[0]).toContain("Cliente Delivery");
  });

  it("REQ-WSOD-002 INTAKE persists the EXACT R2 put key onto the intake row (write integrity)", async () => {
    // The DB write must record the SAME key the PDF was put under (not a stale or
    // mismatched key). This pins the persisted pdf_r2_key to the single R2 put.
    const { env, putKeys } = makeRecordingEnv();
    installFetchRecorder();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const so = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-2026-0005",
      customerName: "Cliente Write",
      assetName: "Balança Write",
    });
    const intake = await seedIntakeDocument({
      serviceOrderId: so.serviceOrderId,
      serviceOrderNumber: so.serviceOrderNumber,
    });

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_INTAKE_DOCUMENT",
      serviceOrderId: so.serviceOrderId,
      documentId: intake.documentId,
      userId: org.userId,
    });

    // Exactly one PDF put, and the intake row stores precisely that key.
    expect(putKeys).toHaveLength(1);
    const after = await intakeDocRow(intake.documentId);
    expect(asString(after.pdf_r2_key)).toBe(putKeys[0]);
  });

  it("REQ-WSOD-001 [HIGH RISK] resolves + renders ONLY the target SO's own org data (no cross-tenant leak)", async () => {
    const { env, putKeys } = makeRecordingEnv();
    const { htmlBodies } = installFetchRecorder();

    // org-A is the target; org-B is a separate tenant with its own SO + intake doc
    // that must NEVER appear in org-A's render or be touched by org-A's job.
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const soA = await seedServiceOrder({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      userId: orgA.userId,
      serviceOrderNumber: "OS-A-0001",
      customerName: "Cliente Alpha",
      assetName: "Balanca Alpha",
    });
    const intakeA = await seedIntakeDocument({
      serviceOrderId: soA.serviceOrderId,
      serviceOrderNumber: soA.serviceOrderNumber,
    });

    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    const soB = await seedServiceOrder({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      userId: orgB.userId,
      serviceOrderNumber: "OS-B-0001",
      customerName: "Cliente Beta",
      assetName: "Balanca Beta",
    });
    const intakeB = await seedIntakeDocument({
      serviceOrderId: soB.serviceOrderId,
      serviceOrderNumber: soB.serviceOrderNumber,
    });

    // Run org-A's intake-document job ONLY.
    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_INTAKE_DOCUMENT",
      serviceOrderId: soA.serviceOrderId,
      documentId: intakeA.documentId,
      userId: orgA.userId,
    });

    // The rendered HTML carries org-A's data and NONE of org-B's.
    expect(htmlBodies).toHaveLength(1);
    const html = asString(htmlBodies[0]);
    expect(html).toContain("Cliente Alpha");
    expect(html).toContain("Balanca Alpha");
    expect(html).toContain("OS-A-0001");
    expect(html).not.toContain("Cliente Beta");
    expect(html).not.toContain("Balanca Beta");
    expect(html).not.toContain("OS-B-0001");

    // The written R2 key + the persisted key are partitioned under org-A, never B.
    // orgPartition = `${slugify(slug)}-${id}` (slug lowercased, id verbatim), so
    // org "org-A" partitions as "org-a-org-A".
    const afterA = await intakeDocRow(intakeA.documentId);
    const keyA = asString(afterA.pdf_r2_key);
    expect(keyA).toContain("org/org-a-org-A/");
    expect(keyA).not.toContain("org-B");
    expect(keyA).not.toContain("org-b");
    expect(keyA).not.toContain("Beta");
    expect(putKeys).toEqual([keyA]);

    // org-B's intake doc is COMPLETELY untouched: no pdf key, no issuance stamp.
    const afterB = await intakeDocRow(intakeB.documentId);
    expect(afterB.pdf_r2_key).toBeNull();
    expect(afterB.issued_at).toBeNull();
    expect(afterB.issued_by_user_id).toBeNull();
  });
});
