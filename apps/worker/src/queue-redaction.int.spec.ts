import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { enqueueQueueJob } from "@calibra-facil/db/queue";
import { appQueueJob } from "@calibra-facil/db/schema";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";

// Real-DB tier: a job whose statement fails carries Drizzle's message
// `Failed query: <sql>\nparams: <bound values>`, and the bound values are row
// data (names, e-mails, document numbers). Neither the worker's stderr nor the
// row's `last_error` may keep them.

const { processBackgroundJob } = vi.hoisted(() => ({
  processBackgroundJob: vi.fn(),
}));

vi.mock("@calibra-facil/jobs-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/jobs-core")>()),
  processBackgroundJob,
}));

import { drainQueue } from "../test/integration/drain-queue";

const BOUND_VALUE = "maria.souza@cliente.example";

const CONFIG = {
  workerId: "int-test-worker",
  batchSize: 10,
  pollIntervalMs: 0,
  staleAfterMs: 10 * 60_000,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A real failed statement, so the message has the shape the driver produces. */
async function realFailedStatement(): Promise<Error> {
  try {
    await db.execute(sql`select ${BOUND_VALUE}::int`);
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("the statement was expected to fail");
}

describe("a failing queue job (real Postgres)", () => {
  it("the failed statement's bound values reach neither stderr nor last_error", async () => {
    const failure = await realFailedStatement();
    // The fixture is only meaningful if the raw message does carry the value.
    expect(failure.message).toContain(BOUND_VALUE);
    processBackgroundJob.mockRejectedValue(failure);

    const id = await enqueueQueueJob(
      { type: "CERTIFICATE", jobId: 1, userId: "user-1" },
      { maxAttempts: 1 },
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "warn").mockImplementation(() => {});

    await drainQueue(makeTestEnv(), CONFIG);

    const [row] = await db
      .select()
      .from(appQueueJob)
      .where(eq(appQueueJob.id, id));
    expect(row?.status).toBe("FAILED");
    expect(row?.lastError).toContain("Failed query");
    expect(row?.lastError).not.toContain(BOUND_VALUE);

    const written = [...stderr.mock.calls, ...stdout.mock.calls]
      .flat()
      .map((value) => String(value))
      .join("\n");
    expect(written).toContain("Queue job");
    expect(written).not.toContain(BOUND_VALUE);
  });
});
