import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createR2Client,
  generatePresignedUploadUrl,
  generatePresignedUrl,
  type R2Env,
} from "./storage";

const env: R2Env = {
  R2_ACCOUNT_ID: "",
  R2_ENDPOINT: "http://s3:7070",
  R2_REGION: "us-east-1",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "documents",
  R2_MEDIA_BUCKET_NAME: "media",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("presigned URLs", () => {
  it("are signed for the store's own endpoint by default", async () => {
    vi.stubEnv("R2_PUBLIC_ENDPOINT", "");
    const url = new URL(
      await generatePresignedUrl(createR2Client(env), "documents", "a/b.pdf"),
    );

    expect(url.origin).toBe("http://s3:7070");
    expect(url.pathname).toBe("/documents/a/b.pdf");
  });

  it("point browsers at R2_PUBLIC_ENDPOINT when the store is internal", async () => {
    vi.stubEnv("R2_PUBLIC_ENDPOINT", "https://files.lab.example/");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    const client = createR2Client(env);

    const download = new URL(
      await generatePresignedUrl(client, "documents", "a/b.pdf"),
    );
    const upload = new URL(
      await generatePresignedUploadUrl(
        client,
        "media",
        "logo.png",
        "image/png",
      ),
    );

    expect(download.origin).toBe("https://files.lab.example");
    expect(download.pathname).toBe("/documents/a/b.pdf");
    expect(download.searchParams.get("X-Amz-Credential")).toMatch(/^key\//);
    expect(upload.origin).toBe("https://files.lab.example");
    expect(upload.pathname).toBe("/media/logo.png");
  });
});
