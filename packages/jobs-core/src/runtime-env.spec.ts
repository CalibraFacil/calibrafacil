import { loadWorkerConfig } from "@calibra-facil/config";
import { describe, expect, it } from "vitest";
import { createJobsEnv } from "./runtime-env";

const key = Buffer.alloc(32, 3).toString("base64");

const COMPLETE = {
  DATABASE_URL: "postgres://calibra:pw@db:5432/calibra",
  R2_ENDPOINT: "http://s3:7070",
  R2_ACCESS_KEY_ID: "calibra",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "docs",
  R2_MEDIA_BUCKET_NAME: "media",
  SIGNING_MASTER_KEY: key,
  INTEGRATIONS_MASTER_KEY: key,
  PUBLIC_API_MASTER_KEY: key,
  GOTENBERG_URL: "http://gotenberg:3000",
  RESEND_API_KEY: "re_123",
  EMAIL_FROM: "lab@example.com",
  WEB_URL: "https://lab.example.com",
  APP_URL: "https://app.example.com",
  SIGNING_TSA_URL: "https://act.example/tsa",
  SIGNING_TSA_TIMEOUT_MS: "20000",
};

describe("createJobsEnv", () => {
  it("maps the validated worker configuration to the handlers' environment", () => {
    const env = createJobsEnv(loadWorkerConfig(COMPLETE));

    expect(env).toMatchObject({
      DATABASE_URL: COMPLETE.DATABASE_URL,
      GOTENBERG_URL: COMPLETE.GOTENBERG_URL,
      SIGNING_MASTER_KEY: key,
      SIGNING_TSA_URL: "https://act.example/tsa",
      SIGNING_TSA_TIMEOUT_MS: "20000",
      INTEGRATIONS_MASTER_KEY: key,
      PUBLIC_API_MASTER_KEY: key,
      RESEND_API_KEY: "re_123",
      EMAIL_FROM: "lab@example.com",
      WEB_URL: "https://lab.example.com",
      APP_URL: "https://app.example.com",
    });
  });

  it("binds a bucket for the documents and another for the media", () => {
    const env = createJobsEnv(loadWorkerConfig(COMPLETE));

    expect(typeof env.CERTIFICATES_BUCKET.get).toBe("function");
    expect(typeof env.MEDIA_BUCKET.put).toBe("function");
    expect(env.CERTIFICATES_BUCKET).not.toBe(env.MEDIA_BUCKET);
  });
});
