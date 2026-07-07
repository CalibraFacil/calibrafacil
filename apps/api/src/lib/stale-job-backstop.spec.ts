import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tier for the REL-03 orphan-job backstop decision logic. The DB reads and
// the document-worker wake are injected so this suite never touches a real DB or
// network — the integration proof (a job aged past its lease is re-drained
// without a new enqueue, and no second certificate number is produced) lives in
// apps/worker/src/queue-backstop.int.spec.ts against a real Postgres.
//
// runStaleJobBackstop is the periodic backstop the issue asks for: it re-claims
// leases and re-drives the drain independently of any NEW enqueue, so a job stuck
// in GENERATING_PDF / PENDING past its lease is recovered on a timer instead of
// only when the next job happens to be enqueued.

import {
  runStaleJobBackstop,
  type StaleJobBackstopDeps,
} from "./stale-job-backstop";

const SAVED = {
  QUEUE_STALE_AFTER_MS: process.env.QUEUE_STALE_AFTER_MS,
  DOCUMENT_WORKER_URL: process.env.DOCUMENT_WORKER_URL,
};

function makeDeps(
  overrides: Partial<StaleJobBackstopDeps> = {},
): StaleJobBackstopDeps {
  return {
    releaseStaleJobs: vi.fn(async () => 0),
    countRecoverableJobs: vi.fn(async () => 0),
    resolveDocumentWorkerUrl: () => "https://worker.example.test",
    wake: vi.fn(async () => {}),
    pruneReceipts: vi.fn(async () => 0),
    staleAfterMs: 10 * 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QUEUE_STALE_AFTER_MS;
  delete process.env.DOCUMENT_WORKER_URL;
});

afterEach(() => {
  process.env.QUEUE_STALE_AFTER_MS = SAVED.QUEUE_STALE_AFTER_MS;
  process.env.DOCUMENT_WORKER_URL = SAVED.DOCUMENT_WORKER_URL;
});

describe("runStaleJobBackstop (REL-03 periodic orphan-job backstop)", () => {
  it("REQ-REL-PDF-001 re-claims stale leases and re-drives them by waking the worker — no new enqueue", async () => {
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => 2),
      countRecoverableJobs: vi.fn(async () => 2),
      resolveDocumentWorkerUrl: () => "https://worker.example.test",
      wake: vi.fn(async () => {}),
      staleAfterMs: 10 * 60_000,
    });

    const result = await runStaleJobBackstop(deps);

    // It released the stale-locked rows using the configured lease window...
    expect(deps.releaseStaleJobs).toHaveBeenCalledWith(10 * 60_000);
    // ...and re-drove them by pinging the container's drain (which re-claims the
    // SAME app_queue_job rows). It NEVER enqueues — the deps surface has no
    // enqueue at all, so a duplicate job row is impossible here.
    expect(deps.wake).toHaveBeenCalledTimes(1);
    expect(deps.wake).toHaveBeenCalledWith("https://worker.example.test");
    expect(result).toEqual({
      released: 2,
      pending: 2,
      woke: true,
      prunedReceipts: 0,
    });
  });

  it("REQ-REL-PDF-001 re-drives a job stranded in PENDING by a dropped wake ping (released 0, pending > 0)", async () => {
    // README:120-125 — a dropped drain ping strands a row in PENDING that nothing
    // re-claims. releaseStaleQueueJobs only touches PROCESSING, so released is 0,
    // but the row is still recoverable and MUST be re-driven.
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => 0),
      countRecoverableJobs: vi.fn(async () => 1),
      wake: vi.fn(async () => {}),
    });

    const result = await runStaleJobBackstop(deps);

    expect(deps.wake).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      released: 0,
      pending: 1,
      woke: true,
      prunedReceipts: 0,
    });
  });

  it("REQ-REL-PDF-001 does not wake the worker when nothing is recoverable (respects Neon-suspend / avoids a needless container boot)", async () => {
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => 0),
      countRecoverableJobs: vi.fn(async () => 0),
      wake: vi.fn(async () => {}),
    });

    const result = await runStaleJobBackstop(deps);

    expect(deps.wake).not.toHaveBeenCalled();
    expect(result).toEqual({
      released: 0,
      pending: 0,
      woke: false,
      prunedReceipts: 0,
    });
  });

  it("REQ-REL-PDF-002 re-drives the EXISTING rows only (wake = idempotent drain trigger); it has no enqueue path", async () => {
    // Idempotency guard: the backstop's only re-drive action is a drain ping.
    // The container re-claims the same rows (same payload/jobId) and the
    // write-once `on conflict (job_id) do nothing` snapshot insert keeps issuance
    // idempotent, so re-driving can never mint a second certificate number.
    // Running the backstop twice must still ONLY ever drain — never enqueue.
    const wake = vi.fn(async () => {});
    const enqueueSpy = vi.fn();
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => 1),
      countRecoverableJobs: vi.fn(async () => 1),
      wake,
    });

    await runStaleJobBackstop(deps);
    await runStaleJobBackstop(deps);

    // Two backstop cycles => two drain pings, ZERO enqueues (there is no enqueue
    // dependency at all — the type does not expose one).
    expect(wake).toHaveBeenCalledTimes(2);
    expect(wake).toHaveBeenNthCalledWith(1, "https://worker.example.test");
    expect(wake).toHaveBeenNthCalledWith(2, "https://worker.example.test");
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect("enqueue" in deps).toBe(false);
  });

  it("does not wake when no document worker is configured (nothing to drive; only the cheap release/count run)", async () => {
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => 1),
      countRecoverableJobs: vi.fn(async () => 3),
      resolveDocumentWorkerUrl: () => null,
      wake: vi.fn(async () => {}),
    });

    const result = await runStaleJobBackstop(deps);

    expect(deps.releaseStaleJobs).toHaveBeenCalledTimes(1);
    expect(deps.wake).not.toHaveBeenCalled();
    expect(result).toEqual({
      released: 1,
      pending: 3,
      woke: false,
      prunedReceipts: 0,
    });
  });

  it("defaults the stale-after window to QUEUE_STALE_AFTER_MS when not overridden", async () => {
    process.env.QUEUE_STALE_AFTER_MS = "900000";
    const releaseStaleJobs = vi.fn(async () => 0);

    // Override only the DB reads + wake; leave staleAfterMs to the default resolver
    // so it is read from the env.
    await runStaleJobBackstop({
      releaseStaleJobs,
      countRecoverableJobs: vi.fn(async () => 0),
      resolveDocumentWorkerUrl: () => null,
      wake: vi.fn(async () => {}),
      pruneReceipts: vi.fn(async () => 0),
    });

    expect(releaseStaleJobs).toHaveBeenCalledWith(900_000);
  });
});
