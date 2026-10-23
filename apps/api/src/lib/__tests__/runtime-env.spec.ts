import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerRuntimeEnv } from "../runtime-env";

const key = Buffer.alloc(32, 3).toString("base64");

function stubWorkerEnvironment() {
  vi.stubEnv("DATABASE_URL", "postgres://calibra:pw@db:5432/calibra");
  vi.stubEnv("R2_ENDPOINT", "http://s3:7070");
  vi.stubEnv("R2_ACCESS_KEY_ID", "calibra");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET_NAME", "docs");
  vi.stubEnv("R2_MEDIA_BUCKET_NAME", "media");
  vi.stubEnv("SIGNING_MASTER_KEY", key);
  vi.stubEnv("INTEGRATIONS_MASTER_KEY", key);
  for (const name of [
    "SIGNING_TSA_URL",
    "SIGNING_TSA_AUTH",
    "SIGNING_TSA_ICP_CONFORMANT",
    "SIGNING_TSA_TIMEOUT_MS",
  ]) {
    vi.stubEnv(name, "");
  }
}

describe("REQ-TSA-1 the API-built worker environment (cron, inline)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("REQ-TSA-1: createWorkerRuntimeEnv carries every SIGNING_TSA_* variable", () => {
    stubWorkerEnvironment();
    vi.stubEnv("SIGNING_TSA_URL", "https://act.example/tsa");
    vi.stubEnv("SIGNING_TSA_AUTH", "Basic abc123");
    vi.stubEnv("SIGNING_TSA_ICP_CONFORMANT", "true");
    vi.stubEnv("SIGNING_TSA_TIMEOUT_MS", "20000");

    const env = createWorkerRuntimeEnv();

    expect(env.SIGNING_TSA_URL).toBe("https://act.example/tsa");
    expect(env.SIGNING_TSA_AUTH).toBe("Basic abc123");
    expect(env.SIGNING_TSA_ICP_CONFORMANT).toBe("true");
    expect(env.SIGNING_TSA_TIMEOUT_MS).toBe("20000");
  });

  it("REQ-TSA-3: createWorkerRuntimeEnv with no TSA configured leaves it off", () => {
    stubWorkerEnvironment();

    const env = createWorkerRuntimeEnv();

    expect(env.SIGNING_TSA_URL).toBeUndefined();
    expect(env.SIGNING_TSA_AUTH).toBeUndefined();
    expect(env.SIGNING_TSA_TIMEOUT_MS).toBeUndefined();
  });
});
