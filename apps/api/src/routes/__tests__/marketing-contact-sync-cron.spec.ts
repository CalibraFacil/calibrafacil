/**
 * REQ-SYNC-007 — the marketing-contact-sync cron is wired exactly like
 * portal-digest: a JOB_HANDLERS entry that runs under runCron's lease and
 * enqueues the MARKETING_CONTACT_SYNC background job with a date-bucketed
 * idempotency key (so a same-day re-trigger is deduped, not a double-blast).
 *
 * runCron and the enqueue are mocked so the wiring is asserted without a DB or
 * a queue; the cron-routing-parity spec separately guards the vercel.json
 * schedule <-> handler bijection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { enqueueBackgroundJobMock, runCronMock } = vi.hoisted(() => ({
  enqueueBackgroundJobMock: vi.fn(async () => ({ messageId: "test" })),
  runCronMock: vi.fn(),
}));

// Mock the enqueue (path as it resolves from this test file -> same module id
// dispatch.ts imports as "../../src/lib/background-jobs").
vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));

// Mock runCron to just invoke the task (no lease / DB) and return its value.
vi.mock("../../../vercel-src/cron/cron-run", () => ({
  runCron: runCronMock,
}));

import { JOB_HANDLERS } from "../../../vercel-src/cron/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
  runCronMock.mockImplementation(
    async (_job: string, _opts: unknown, task: () => Promise<unknown>) => {
      const value = await task();
      return Response.json(value ?? { ok: true });
    },
  );
});

describe("REQ-SYNC-007: marketing-contact-sync cron wiring", () => {
  it("REQ-SYNC-007 registers a handler under the expected job key", () => {
    expect(typeof JOB_HANDLERS["marketing-contact-sync"]).toBe("function");
  });

  it("REQ-SYNC-007 leases the run and enqueues the timer job with a date-bucketed key", async () => {
    const handler = JOB_HANDLERS["marketing-contact-sync"];
    const response = await handler(
      new Request("https://api.test/api/cron/marketing-contact-sync"),
    );

    expect(response.status).toBe(200);
    expect(runCronMock).toHaveBeenCalledTimes(1);
    expect(runCronMock.mock.calls[0][0]).toBe("marketing-contact-sync");

    expect(enqueueBackgroundJobMock).toHaveBeenCalledTimes(1);
    const [message, options] = enqueueBackgroundJobMock.mock.calls[0];
    expect(message).toEqual({ type: "MARKETING_CONTACT_SYNC" });
    expect(options.idempotencyKey).toMatch(
      /^marketing-contact-sync-\d{4}-\d{2}-\d{2}$/,
    );
  });
});
