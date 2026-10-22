import { describe, expect, it } from "vitest";
import { loadWorkerConfig, workerSigningEnv } from "./index";

const KEY = Buffer.alloc(32, 5).toString("base64");

const BASE = {
  DATABASE_URL: "postgres://a/b",
  R2_ENDPOINT: "http://localhost:59000",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "docs",
  R2_MEDIA_BUCKET_NAME: "media",
  SIGNING_MASTER_KEY: KEY,
  INTEGRATIONS_MASTER_KEY: KEY,
};

describe("REQ-TSA-1 the shared worker signing environment", () => {
  it("REQ-TSA-1: carries every SIGNING_TSA_* variable and the master key", () => {
    const config = loadWorkerConfig({
      ...BASE,
      SIGNING_TSA_URL: "https://act.example/tsa",
      SIGNING_TSA_AUTH: "Basic abc123",
      SIGNING_TSA_ICP_CONFORMANT: "true",
      SIGNING_TSA_TIMEOUT_MS: "15000",
    });

    expect(workerSigningEnv(config.signing)).toEqual({
      SIGNING_MASTER_KEY: KEY,
      SIGNING_TSA_URL: "https://act.example/tsa",
      SIGNING_TSA_AUTH: "Basic abc123",
      SIGNING_TSA_ICP_CONFORMANT: "true",
      SIGNING_TSA_TIMEOUT_MS: "15000",
    });
  });

  it("REQ-TSA-3: with no TSA configured no TSA variable is set", () => {
    const config = loadWorkerConfig(BASE);
    const env = workerSigningEnv(config.signing);

    expect(env.SIGNING_MASTER_KEY).toBe(KEY);
    expect(env.SIGNING_TSA_URL).toBeUndefined();
    expect(env.SIGNING_TSA_AUTH).toBeUndefined();
    expect(env.SIGNING_TSA_TIMEOUT_MS).toBeUndefined();
  });

  it("REQ-TSA-1: validates the TSA address and the timeout", () => {
    expect(() =>
      loadWorkerConfig({ ...BASE, SIGNING_TSA_URL: "not a url" }),
    ).toThrow(/SIGNING_TSA_URL/);
    expect(() =>
      loadWorkerConfig({ ...BASE, SIGNING_TSA_TIMEOUT_MS: "soon" }),
    ).toThrow(/SIGNING_TSA_TIMEOUT_MS/);
    expect(() =>
      loadWorkerConfig({ ...BASE, SIGNING_TSA_TIMEOUT_MS: "5" }),
    ).toThrow(/SIGNING_TSA_TIMEOUT_MS/);
  });
});
