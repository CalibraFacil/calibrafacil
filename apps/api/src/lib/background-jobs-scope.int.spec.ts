/**
 * background-jobs-scope.int.spec.ts: a background job enqueued inside a
 * transaction scope (the desktop sync apply) is sent after the commit, and not
 * at all when the transaction rolls back (D3).
 *
 *   - a row of the database queue (`queue` mode) is written IN the transaction,
 *     so it commits or rolls back with the change; the document-worker ping
 *     goes after the commit;
 *   - every dispatch that leaves the database (the in-process `local` /
 *     `inline` runners that read the committed rows) goes after the commit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runInTransactionScope } from "@calibra-facil/db";
import { appQueueJob } from "@calibra-facil/db/schema";
import type { BackgroundJobMessage } from "@calibra-facil/schemas";
import { truncateAll } from "../../test/integration/db";

const mocks = vi.hoisted(() => ({
  processBackgroundJob: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./worker-modules", () => ({
  importWorkerModule: async () => ({
    processBackgroundJob: mocks.processBackgroundJob,
  }),
}));

vi.mock("./runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { enqueueBackgroundJob } from "./background-jobs";

const message: BackgroundJobMessage = {
  type: "OOT_NOTIFICATION",
  notificationId: 1,
  userId: "user-1",
};

class Rollback extends Error {}

async function enqueueInScopeThenCommit() {
  await runInTransactionScope(async () => {
    await enqueueBackgroundJob(message);
  });
}

async function enqueueInScopeThenRollBack() {
  await expect(
    runInTransactionScope(async () => {
      await enqueueBackgroundJob(message);
      throw new Rollback("the event failed");
    }),
  ).rejects.toThrow(Rollback);
}

beforeEach(async () => {
  await truncateAll();
  mocks.processBackgroundJob.mockReset().mockResolvedValue(undefined);
  mocks.fetch
    .mockReset()
    .mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("DOCUMENT_WORKER_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("in-process runners (D3)", () => {
  it.each(["inline", "local"] as const)(
    "D3 [HIGH RISK]: %s mode runs the job after the commit, once, and never on a rollback",
    async (mode) => {
      vi.stubEnv("BACKGROUND_JOBS_MODE", mode);

      await runInTransactionScope(async () => {
        await enqueueBackgroundJob(message);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
      });
      await vi.waitFor(() =>
        expect(mocks.processBackgroundJob).toHaveBeenCalledTimes(1),
      );

      mocks.processBackgroundJob.mockClear();
      await enqueueInScopeThenRollBack();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
    },
  );
});

describe("database queue (D3)", () => {
  beforeEach(() => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    vi.stubEnv("DOCUMENT_WORKER_URL", "https://worker.example.test");
    vi.stubEnv("DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS", "0");
  });

  it("D3 [HIGH RISK]: the queue row joins the transaction (visible inside, durable after the commit) and the worker is woken after the commit", async () => {
    await runInTransactionScope(async () => {
      await enqueueBackgroundJob(message);
      expect(await db.select().from(appQueueJob)).toHaveLength(1);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    expect(await db.select().from(appQueueJob)).toHaveLength(1);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  });

  it("D3 [HIGH RISK]: on a rollback the queue row is gone and the worker is not woken", async () => {
    await enqueueInScopeThenRollBack();

    expect(await db.select().from(appQueueJob)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("D3: the committed path leaves exactly one queue row", async () => {
    await enqueueInScopeThenCommit();

    expect(await db.select().from(appQueueJob)).toHaveLength(1);
  });
});
