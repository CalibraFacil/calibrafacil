import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createR2Client,
  generateBoundPresignedUploadUrl,
  generatePresignedUploadUrl,
  hashObjectSha256,
  r2EnvForStorageDependentWork,
  r2EnvFromSettings,
  r2EnvFromStorageConfig,
  StorageNotConfiguredError,
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

const settings = {
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucketName: "documents",
  mediaBucketName: "media",
};

describe("r2EnvFromSettings", () => {
  it("counts an endpoint alone as configured (the self-hosted stack)", () => {
    const resolved = r2EnvFromSettings({
      ...settings,
      endpoint: "http://s3:7070",
      region: "us-east-1",
    });

    expect(resolved).toMatchObject({
      R2_ENDPOINT: "http://s3:7070",
      R2_REGION: "us-east-1",
      R2_BUCKET_NAME: "documents",
    });
    expect(resolved?.R2_ACCOUNT_ID).toBeUndefined();
  });

  it("counts an account id alone as configured (Cloudflare R2)", () => {
    expect(r2EnvFromSettings({ ...settings, accountId: "abc" })).toMatchObject({
      R2_ACCOUNT_ID: "abc",
    });
  });

  it("is null without a way to reach the store, credentials or a bucket", () => {
    expect(r2EnvFromSettings(settings)).toBeNull();
    expect(r2EnvFromSettings({ ...settings, endpoint: "  " })).toBeNull();
    expect(
      r2EnvFromSettings({ ...settings, endpoint: "http://s3", bucketName: "" }),
    ).toBeNull();
    expect(
      r2EnvFromSettings({
        ...settings,
        endpoint: "http://s3",
        secretAccessKey: undefined,
      }),
    ).toBeNull();
  });

  it("builds a client for the endpoint, path-style, with no account id", async () => {
    const resolved = r2EnvFromSettings({
      ...settings,
      endpoint: "http://s3:7070",
    });
    if (!resolved) throw new Error("expected a resolved environment");
    vi.stubEnv("R2_PUBLIC_ENDPOINT", "");

    const url = new URL(
      await generatePresignedUrl(createR2Client(resolved), "documents", "k"),
    );

    expect(url.origin).toBe("http://s3:7070");
    expect(url.pathname).toBe("/documents/k");
  });
});

describe("storage configuration from the environment", () => {
  function stubStorageEnv(nodeEnv: string, extra: Record<string, string>) {
    vi.stubEnv("NODE_ENV", nodeEnv);
    for (const name of ["R2_ACCOUNT_ID", "R2_ENDPOINT"]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET_NAME", "documents");
    vi.stubEnv("R2_MEDIA_BUCKET_NAME", "media");
    for (const [name, value] of Object.entries(extra)) {
      vi.stubEnv(name, value);
    }
  }

  it("resolves with only R2_ENDPOINT, as deploy/compose.yaml sets it", () => {
    stubStorageEnv("production", { R2_ENDPOINT: "http://s3:7070" });

    expect(r2EnvFromStorageConfig()).toMatchObject({
      R2_ENDPOINT: "http://s3:7070",
    });
    expect(r2EnvForStorageDependentWork("do the work")).not.toBeNull();
  });

  it("is null in development when unconfigured", () => {
    stubStorageEnv("development", {});

    expect(r2EnvForStorageDependentWork("do the work")).toBeNull();
  });

  it("throws in production when unconfigured, instead of degrading silently", () => {
    stubStorageEnv("production", {});

    expect(() => r2EnvForStorageDependentWork("do the work")).toThrow(
      StorageNotConfiguredError,
    );
  });
});

describe("generateBoundPresignedUploadUrl", () => {
  const signedHeaders = (url: string) =>
    (new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");

  it("signs content-length and content-type into the upload (the binding the store enforces)", async () => {
    vi.stubEnv("R2_PUBLIC_ENDPOINT", "");
    const url = await generateBoundPresignedUploadUrl(
      createR2Client(env),
      "documents",
      "k.jpg",
      { contentType: "image/jpeg", contentLength: 2048 },
    );

    expect(signedHeaders(url)).toEqual(
      expect.arrayContaining(["content-length", "content-type", "host"]),
    );
  });

  it("is what makes the difference: a plain presign signs neither header", async () => {
    vi.stubEnv("R2_PUBLIC_ENDPOINT", "");
    const url = await generatePresignedUploadUrl(
      createR2Client(env),
      "documents",
      "k.jpg",
      "image/jpeg",
    );

    expect(signedHeaders(url)).not.toContain("content-length");
    expect(signedHeaders(url)).not.toContain("content-type");
  });
});

describe("hashObjectSha256", () => {
  function clientAnswering(answer: () => unknown) {
    const client = createR2Client(env);
    const sent: unknown[] = [];
    vi.spyOn(client, "send").mockImplementation(async (command: unknown) => {
      sent.push(command);
      return answer();
    });
    return { client, sent };
  }

  const chunked = (...chunks: Uint8Array[]) => ({
    Body: {
      transformToWebStream: () =>
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
    },
  });

  it("hashes the object chunk by chunk, conditional on the ETag it was told", async () => {
    const { client, sent } = clientAnswering(() =>
      chunked(
        new TextEncoder().encode("hello "),
        new TextEncoder().encode("world"),
      ),
    );

    const hashed = await hashObjectSha256(client, "documents", "k", {
      etag: "abc",
      maxBytes: 100,
    });

    expect(hashed).toEqual({
      ok: true,
      sha256: createHash("sha256").update("hello world").digest("hex"),
      sizeBytes: 11,
    });
    expect(sent[0]).toMatchObject({ input: { IfMatch: '"abc"' } });
  });

  it("reports an object replaced since the HEAD (412) as changed", async () => {
    const { client } = clientAnswering(() => {
      throw Object.assign(new Error("PreconditionFailed"), {
        name: "PreconditionFailed",
        $metadata: { httpStatusCode: 412 },
      });
    });

    await expect(
      hashObjectSha256(client, "documents", "k", {
        etag: "abc",
        maxBytes: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "changed" });
  });

  it("reports a missing object, and stops reading past the limit", async () => {
    const missing = clientAnswering(() => {
      throw Object.assign(new Error("NoSuchKey"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      });
    });
    await expect(
      hashObjectSha256(missing.client, "documents", "k", {
        etag: null,
        maxBytes: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing" });

    const big = clientAnswering(() =>
      chunked(new Uint8Array(60), new Uint8Array(60)),
    );
    await expect(
      hashObjectSha256(big.client, "documents", "k", {
        etag: null,
        maxBytes: 100,
      }),
    ).resolves.toEqual({ ok: false, reason: "too_large" });
  });
});
