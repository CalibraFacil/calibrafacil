import { describe, expect, it, vi } from "vitest";

// Unit tier for the /api/health readiness probe. All dependency
// probes are injected so this suite never touches a real DB or network; the
// route itself is a thin wrapper that maps status -> 200/503.

import { S3Client } from "@aws-sdk/client-s3";

import {
  runApiHealthCheck,
  runHealthCheck,
  type HealthCheckDeps,
} from "./health";

function makeDeps(overrides: Partial<HealthCheckDeps> = {}): HealthCheckDeps {
  return {
    pingDatabase: vi.fn(async () => {}),
    probeStorage: vi.fn(async () => {}),
    storageRequired: false,
    readQueueDepth: vi.fn(async () => ({
      pending: 2,
      processing: 1,
      failed: 0,
    })),
    timeoutMs: 200,
    ...overrides,
  };
}

describe("runHealthCheck", () => {
  it("reports ok with queue depth when every dependency responds", async () => {
    const report = await runHealthCheck(makeDeps());

    expect(report.status).toBe("ok");
    expect(report.checks.database.ok).toBe(true);
    expect(report.checks.storage.ok).toBe(true);
    expect(report.checks.queue).toMatchObject({
      ok: true,
      depth: { pending: 2, processing: 1, failed: 0 },
    });
  });

  it("goes unavailable when the database ping throws", async () => {
    const report = await runHealthCheck(
      makeDeps({
        pingDatabase: vi.fn(async () => {
          throw new Error("connect ECONNREFUSED db.internal:5432");
        }),
      }),
    );

    expect(report.status).toBe("unavailable");
    expect(report.checks.database.ok).toBe(false);
  });

  it("redacts failures to the error name — never the message", async () => {
    class BucketProbeError extends Error {
      constructor() {
        super("HeadBucket https://acc.r2.cloudflarestorage.com/documents 403");
        this.name = "BucketProbeError";
      }
    }
    const report = await runHealthCheck(
      makeDeps({
        probeStorage: vi.fn(async () => {
          throw new BucketProbeError();
        }),
      }),
    );

    expect(report.status).toBe("unavailable");
    expect(report.checks.storage).toMatchObject({
      ok: false,
      error: "BucketProbeError",
    });
    expect(JSON.stringify(report)).not.toContain("cloudflarestorage");
  });

  it("times out a hung dependency instead of hanging the probe", async () => {
    const report = await runHealthCheck(
      makeDeps({
        timeoutMs: 20,
        pingDatabase: () => new Promise<void>(() => {}),
      }),
    );

    expect(report.status).toBe("unavailable");
    expect(report.checks.database).toMatchObject({
      ok: false,
      error: "timeout",
    });
  });

  it("skips (but stays healthy) when storage is not configured", async () => {
    const report = await runHealthCheck(makeDeps({ probeStorage: null }));

    expect(report.status).toBe("ok");
    expect(report.checks.storage).toMatchObject({ ok: true, skipped: true });
  });

  it("fails (503) when storage is not configured where it is required (production)", async () => {
    const report = await runHealthCheck(
      makeDeps({ probeStorage: null, storageRequired: true }),
    );

    expect(report.status).toBe("unavailable");
    expect(report.checks.storage).toMatchObject({
      ok: false,
      error: "StorageNotConfigured",
    });
    expect(report.checks.storage.skipped).toBeUndefined();
  });

  it("still reports queue failure independently of the db ping", async () => {
    const report = await runHealthCheck(
      makeDeps({
        readQueueDepth: vi.fn(async () => {
          throw new Error("relation app_queue_job does not exist");
        }),
      }),
    );

    expect(report.status).toBe("unavailable");
    expect(report.checks.database.ok).toBe(true);
    expect(report.checks.queue.ok).toBe(false);
    expect(report.checks.queue.depth).toBeUndefined();
  });
});

describe("runApiHealthCheck", () => {
  const baseEnv = {
    R2_ACCESS_KEY_ID: "calibra",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "docs",
    R2_MEDIA_BUCKET_NAME: "media",
  };
  const stubs = {
    pingDatabase: async () => {},
    readQueueDepth: async () => ({ pending: 0, processing: 0, failed: 0 }),
  };

  it("fails in production when no account id and no endpoint is set", async () => {
    const report = await runApiHealthCheck(
      { ...baseEnv, NODE_ENV: "production" },
      stubs,
    );

    expect(report.status).toBe("unavailable");
    expect(report.checks.storage).toMatchObject({
      ok: false,
      error: "StorageNotConfigured",
    });
  });

  it("still skips in development", async () => {
    const report = await runApiHealthCheck(
      { ...baseEnv, NODE_ENV: "development" },
      stubs,
    );

    expect(report.status).toBe("ok");
    expect(report.checks.storage).toMatchObject({ ok: true, skipped: true });
  });

  it("probes the store when only R2_ENDPOINT is set (the self-hosted stack)", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockImplementation(async () => ({}));
    try {
      const report = await runApiHealthCheck(
        {
          ...baseEnv,
          NODE_ENV: "production",
          R2_ENDPOINT: "http://s3:7070",
        },
        stubs,
      );

      expect(report.checks.storage.skipped).toBeUndefined();
      expect(report.checks.storage.ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
    }
  });
});
