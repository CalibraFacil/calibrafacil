/**
 * background-jobs-scope.int.spec.ts: a background job emitted with `ctx.emit`
 * of `withOrg` inside a transaction scope (the desktop sync apply) is sent
 * after the scope's commit, and not at all when the transaction rolls back
 * (D3).
 *
 *   - a row of the database queue (`queue` mode) is written IN the transaction,
 *     so it commits or rolls back with the change (the polling worker claims it
 *     once committed);
 *   - every dispatch that leaves the database (the in-process `local` runner
 *     that reads the committed rows) goes after the commit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runInTransactionScope } from "@calibra-facil/db";
import { appQueueJob } from "@calibra-facil/db/schema";
import type { BackgroundJobMessage } from "@calibra-facil/schemas";
import { truncateAll } from "../../test/integration/db";

const mocks = vi.hoisted(() => ({
  processBackgroundJob: vi.fn(),
}));

vi.mock("@calibra-facil/jobs-core", () => ({
  processBackgroundJob: mocks.processBackgroundJob,
}));

vi.mock("./runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { SYSTEM_ACTOR, withOrg } from "./org-context";

const message: BackgroundJobMessage = {
  type: "OOT_NOTIFICATION",
  notificationId: 1,
  userId: "user-1",
};

class Rollback extends Error {}

// Inside the scope `withOrg` is a savepoint: the job is staged in it and sent
// after the scope's own commit.
function emitInScope() {
  return withOrg("org-1", SYSTEM_ACTOR, (ctx) => ctx.emit(message));
}

async function enqueueInScopeThenCommit() {
  await runInTransactionScope(async () => {
    await emitInScope();
  });
}

async function enqueueInScopeThenRollBack() {
  await expect(
    runInTransactionScope(async () => {
      await emitInScope();
      throw new Rollback("the event failed");
    }),
  ).rejects.toThrow(Rollback);
}

beforeEach(async () => {
  await truncateAll();
  mocks.processBackgroundJob.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("in-process runner (D3)", () => {
  it("D3 [HIGH RISK]: local mode runs the job after the commit, once, and never on a rollback", async () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "local");

    await runInTransactionScope(async () => {
      await emitInScope();
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
  });
});

describe("database queue (D3)", () => {
  beforeEach(() => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
  });

  it("D3 [HIGH RISK]: the queue row joins the transaction (visible inside, durable after the commit)", async () => {
    await runInTransactionScope(async () => {
      await emitInScope();
      expect(await db.select().from(appQueueJob)).toHaveLength(1);
    });

    expect(await db.select().from(appQueueJob)).toHaveLength(1);
    expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
  });

  it("D3 [HIGH RISK]: on a rollback the queue row is gone", async () => {
    await enqueueInScopeThenRollBack();

    expect(await db.select().from(appQueueJob)).toHaveLength(0);
  });

  it("D3: the committed path leaves exactly one queue row", async () => {
    await enqueueInScopeThenCommit();

    expect(await db.select().from(appQueueJob)).toHaveLength(1);
  });
});
