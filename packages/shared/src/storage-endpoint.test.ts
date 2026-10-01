import { describe, expect, it } from "vitest";

import { resolveS3EndpointConfig } from "./storage-endpoint";

describe("resolveS3EndpointConfig", () => {
  it("derives the Cloudflare R2 endpoint from the account id", () => {
    expect(resolveS3EndpointConfig({ R2_ACCOUNT_ID: "abc123" })).toEqual({
      endpoint: "https://abc123.r2.cloudflarestorage.com",
      region: "auto",
      forcePathStyle: false,
    });
  });

  it("uses a custom S3-compatible endpoint with path-style addressing", () => {
    expect(
      resolveS3EndpointConfig({
        R2_ACCOUNT_ID: "ignored",
        R2_ENDPOINT: "http://localhost:9000/",
      }),
    ).toEqual({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      forcePathStyle: true,
    });
  });

  it("honours an explicit region", () => {
    expect(
      resolveS3EndpointConfig({
        R2_ENDPOINT: "https://s3.example.com",
        R2_REGION: "sa-east-1",
      }).region,
    ).toBe("sa-east-1");
  });

  it("requires an account id or an endpoint", () => {
    expect(() => resolveS3EndpointConfig({ R2_ACCOUNT_ID: "  " })).toThrow(
      "R2_ACCOUNT_ID or R2_ENDPOINT is required",
    );
  });
});
