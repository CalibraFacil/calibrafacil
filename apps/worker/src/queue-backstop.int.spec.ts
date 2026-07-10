import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  claimQueueJobs,
  countRecoverableQueueJobs,
  enqueueQueueJob,
  releaseStaleQueueJobs,
} from "@calibra-facil/db/queue";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

// Real-DB integration tier for the REL-03 orphan-job backstop (#652).
//
// The scenario: a CERTIFICATE render job is durably enqueued into app_queue_job,
// then the drain that should process it is lost — the container died mid-render
// (row stuck in PROCESSING past its 10-min lease) or a wake ping was dropped (row
// stranded in PENDING). In production nothing re-claims it until the NEXT enqueue
// happens, so the certificate sits in GENERATING_PDF forever. This tier proves
// the backstop path re-drains such a job WITHOUT a new enqueue, and that
// re-draining can NEVER mint a second certificate number (the write-once
// `on conflict (job_id) do nothing` snapshot insert).
//
// We exercise the SAME primitives the container's drain uses:
//   releaseStaleQueueJobs (lease reclaim) + drainQueue (claim + process). The
// render itself (XLSX engine, XLSX->PDF converter, signing, email) is stubbed
// exactly as certificate-issuance.int.spec.ts does — we assert DB effects, never
// "it ran".

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => {}),
  notifyAuditPackReady: vi.fn(async () => {}),
}));

vi.mock("@calibra-facil/certificate-xlsx-template", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@calibra-facil/certificate-xlsx-template")
    >();

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

  class FakeConverter {
    async convert(_input: Uint8Array, options?: unknown) {
      return {
        bytes: FAKE_PDF_BYTES,
        metadata: { engine: "local-libreoffice", options: options ?? {} },
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

// vitest hoists the vi.mock calls above the imports, so the worker's static
// import chain (queue-runtime -> ./index) resolves the mocked engine/converters.
import { drainQueue, type QueueRuntimeConfig } from "./queue-runtime";
import type { WorkerEnv } from "./queue-runtime";

const LEASE_MS = 10 * 60_000;

function backstopConfig(): QueueRuntimeConfig {
  return {
    workerId: "backstop-test-worker",
    batchSize: 10,
    pollIntervalMs: 2_000,
    staleAfterMs: LEASE_MS,
  };
}

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

async function jobStatus(jobId: number): Promise<string> {
  const result = await db.execute(
    sql`SELECT status FROM calibration_job WHERE id = ${jobId}`,
  );
  return asString(field(toRows(result)[0], "status"));
}

async function snapshotNumbers(jobId: number): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT certificate_number FROM issued_certificate_snapshot
        WHERE job_id = ${jobId} ORDER BY id`,
  );
  return toRows(result).map((row) =>
    asString(field(row, "certificate_number")),
  );
}

async function queueRows(): Promise<
  Array<{ id: number; status: string; payload: unknown }>
> {
  const result = await db.execute(
    sql`SELECT id, status, payload FROM app_queue_job ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    id: Number(field(row, "id")),
    status: asString(field(row, "status")),
    payload: field(row, "payload"),
  }));
}

/** Force a queue row into PROCESSING with a lease older than the stale window. */
async function ageToOrphanedProcessing(queueJobId: number): Promise<void> {
  await db.execute(sql`
    UPDATE app_queue_job
    SET status = 'PROCESSING',
        locked_by = 'dead-container',
        locked_at = now() - interval '20 minutes'
    WHERE id = ${queueJobId}
  `);
}

async function putSourceXlsx(env: WorkerEnv, xlsxR2Key: string): Promise<void> {
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

const USER_ID = "user-org-1";

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("REL-03 orphan-job backstop (worker real-DB integration)", () => {
  it("REQ-REL-PDF-001 re-drains a job orphaned past its lease WITHOUT a new enqueue", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
    });
    const env = makeTestEnv();
    await putSourceXlsx(env, job.xlsxR2Key);

    // Durably enqueue the render, then simulate the crashed drain: the row is
    // PROCESSING with an expired lease and the job is still GENERATING_PDF.
    const queueJobId = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    await ageToOrphanedProcessing(queueJobId);
    expect(await jobStatus(job.jobId)).toBe("GENERATING_PDF");

    // Precondition: a plain claim does NOT recover it — an orphaned PROCESSING
    // row is invisible to claimQueueJobs. This is exactly the stuck-forever state.
    expect(await claimQueueJobs("someone-else")).toHaveLength(0);

    // The backstop's reclaim step flips the expired lease back to PENDING and
    // reports how many it recovered (drives the periodic wake decision).
    const released = await releaseStaleQueueJobs(LEASE_MS);
    expect(released).toBe(1);
    expect(await countRecoverableQueueJobs()).toBe(1);

    // Re-drive via the SAME drain primitive the container runs on a wake. No new
    // enqueue happened between the orphan and here.
    const processed = await drainQueue(env, backstopConfig());
    expect(processed).toBe(1);

    // The certificate was issued: job APPROVED, exactly one snapshot, one queue
    // row (now COMPLETED). No duplicate job row was created.
    expect(await jobStatus(job.jobId)).toBe("APPROVED");
    expect(await snapshotNumbers(job.jobId)).toEqual([job.jobNumber]);
    const rows = await queueRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("COMPLETED");
  });

  it("REQ-REL-PDF-002 re-driving an already-issued job never mints a second certificate number", async () => {
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
    });
    const env = makeTestEnv();
    await putSourceXlsx(env, job.xlsxR2Key);

    // First drain issues the certificate.
    const firstQueueJobId = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    expect(await drainQueue(env, backstopConfig())).toBe(1);
    expect(await snapshotNumbers(job.jobId)).toEqual([job.jobNumber]);

    // Simulate an at-least-once redelivery that the backstop re-drives: the same
    // job is enqueued + orphaned + released + drained a SECOND time. The
    // write-once `on conflict (job_id) do nothing` snapshot insert must keep this
    // idempotent — still exactly ONE certificate number.
    const secondQueueJobId = await enqueueQueueJob({
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });
    expect(secondQueueJobId).not.toBe(firstQueueJobId);
    await ageToOrphanedProcessing(secondQueueJobId);
    expect(await releaseStaleQueueJobs(LEASE_MS)).toBe(1);
    expect(await drainQueue(env, backstopConfig())).toBe(1);

    // Still one snapshot, same certificate number — no second certificate.
    expect(await snapshotNumbers(job.jobId)).toEqual([job.jobNumber]);
    expect(await jobStatus(job.jobId)).toBe("APPROVED");
  });
});
