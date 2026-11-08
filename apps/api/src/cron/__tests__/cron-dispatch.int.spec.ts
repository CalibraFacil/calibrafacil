/**
 * cron-dispatch.int.spec.ts: `GET /api/cron/:job` against a real Postgres. The dispatcher is the
 * only door of the scheduled work: it must refuse without the secret before any work runs,
 * answer the task's own result, and leave the heartbeat of the run.
 *
 *   REQ-CRON-D-1  an unknown job is a 404; the secret gate (503 unconfigured in production, 401
 *                 wrong credential) refuses BEFORE the task runs: the data the task would
 *                 have swept is still there
 *   REQ-CRON-D-2  with the secret (as a bearer token or as `x-cron-secret`) the task runs and
 *                 answers its counts, the expired rows are gone, the live ones are not, and
 *                 the run's heartbeat is recorded
 *   REQ-CRON-D-4  the certificate-drift job fails in production when storage is unconfigured
 *                 (a clean-looking empty run would hide it), still runs with only R2_ENDPOINT
 *                 (the self-hosted stack) and skips in development
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { cronRun, session, user, verification } from "@calibra-facil/db/schema";
import { truncateAll } from "../../../test/integration/db";
import { GET } from "../dispatch";

const originalEnv = { ...process.env };
const HOUR = 60 * 60 * 1000;

function request(path: string, headers: HeadersInit = {}) {
  return new Request(`https://api.example.test${path}`, { headers });
}

async function seedAuthRows() {
  await db.insert(user).values({
    id: "user-cron",
    name: "Cron",
    email: "cron@lab.test",
  });
  await db.insert(session).values([
    {
      id: "session-expired",
      token: "token-expired",
      userId: "user-cron",
      expiresAt: new Date(Date.now() - HOUR),
    },
    {
      id: "session-live",
      token: "token-live",
      userId: "user-cron",
      expiresAt: new Date(Date.now() + HOUR),
    },
  ]);
  await db.insert(verification).values([
    {
      id: "verification-expired",
      identifier: "a@lab.test",
      value: "x",
      expiresAt: new Date(Date.now() - HOUR),
    },
    {
      id: "verification-expired-2",
      identifier: "b@lab.test",
      value: "y",
      expiresAt: new Date(Date.now() - 2 * HOUR),
    },
    {
      id: "verification-live",
      identifier: "c@lab.test",
      value: "z",
      expiresAt: new Date(Date.now() + HOUR),
    },
  ]);
}

async function surviving() {
  return {
    sessions: (await db.select({ id: session.id }).from(session))
      .map((row) => row.id)
      .toSorted(),
    verifications: (await db.select({ id: verification.id }).from(verification))
      .map((row) => row.id)
      .toSorted(),
  };
}

beforeEach(async () => {
  await truncateAll();
  process.env = { ...originalEnv };
  delete process.env.CRON_SECRET;
  delete process.env.NODE_ENV;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("cron dispatch: the gate", () => {
  it("REQ-CRON-D-1: an unknown job is a 404", async () => {
    const response = await GET(request("/api/cron/bogus"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown cron job: bogus",
    });
  });

  it("REQ-CRON-D-1: production without a CRON_SECRET answers 503 and runs nothing", async () => {
    process.env.NODE_ENV = "production";
    await seedAuthRows();
    const before = await surviving();

    const response = await GET(request("/api/cron/auth-maintenance"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET não configurado",
    });
    expect(await surviving()).toEqual(before);
    expect(await db.select().from(cronRun)).toEqual([]);
  });

  it("REQ-CRON-D-1: a wrong credential answers 401 and runs nothing", async () => {
    process.env.CRON_SECRET = "secret-1";
    await seedAuthRows();
    const before = await surviving();

    for (const headers of [
      { authorization: "Bearer wrong" },
      { "x-cron-secret": "wrong" },
      {},
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- three sequential refusals.
      const response = await GET(
        request("/api/cron/auth-maintenance", headers),
      );
      expect(response.status).toBe(401);
      // oxlint-disable-next-line eslint/no-await-in-loop -- three sequential refusals.
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    }

    expect(await surviving()).toEqual(before);
    expect(await db.select().from(cronRun)).toEqual([]);
  });
});

describe("cron dispatch: a run", () => {
  it.each([
    ["a bearer token", { authorization: "Bearer secret-1" }],
    ["the x-cron-secret header", { "x-cron-secret": "secret-1" }],
  ])(
    "REQ-CRON-D-2: with %s auth-maintenance deletes the expired rows only, answers the counts and records the heartbeat",
    async (_name, headers) => {
      process.env.CRON_SECRET = "secret-1";
      await seedAuthRows();

      const response = await GET(
        request("/api/cron/auth-maintenance", headers),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        deletedSessions: 1,
        deletedVerifications: 2,
      });
      expect(await surviving()).toEqual({
        sessions: ["session-live"],
        verifications: ["verification-live"],
      });
      const [run] = await db.select().from(cronRun);
      expect(run).toMatchObject({
        job: "auth-maintenance",
        lastStatus: "ok",
        consecutiveFailures: 0,
      });
    },
  );
});

describe("cron dispatch: certificate-drift and storage", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "secret-1";
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ENDPOINT;
    Object.assign(process.env, {
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "documents",
      R2_MEDIA_BUCKET_NAME: "media",
    });
  });

  function drift() {
    return GET(
      request("/api/cron/certificate-drift", {
        authorization: "Bearer secret-1",
      }),
    );
  }

  it("REQ-CRON-D-4: production without storage fails the run (and records it) instead of reporting a clean empty run", async () => {
    process.env.NODE_ENV = "production";

    const response = await drift();

    expect(response.status).toBe(500);
    const [run] = await db.select().from(cronRun);
    expect(run).toMatchObject({
      job: "certificate-drift",
      lastStatus: "error",
    });
  });

  it("REQ-CRON-D-4: production with only R2_ENDPOINT (the self-hosted stack) runs the check", async () => {
    process.env.NODE_ENV = "production";
    process.env.R2_ENDPOINT = "http://s3:7070";

    const response = await drift();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ checked: 0 });
    const [run] = await db.select().from(cronRun);
    expect(run?.lastStatus).toBe("ok");
  });

  it("REQ-CRON-D-4: development without storage skips with an empty result", async () => {
    process.env.NODE_ENV = "development";

    const response = await drift();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ checked: 0 });
  });
});
