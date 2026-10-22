import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const env: { value: Record<string, string> | null } = { value: null };
  return { env, downloadFromR2: vi.fn() };
});

vi.mock("./storage", () => ({
  r2EnvFromStorageConfig: () => mocks.env.value,
  createR2Client: () => ({}),
  resolveBucketName: (
    env: { R2_BUCKET_NAME: string; R2_MEDIA_BUCKET_NAME: string },
    bucket: "media" | "documents",
  ) => (bucket === "media" ? env.R2_MEDIA_BUCKET_NAME : env.R2_BUCKET_NAME),
  downloadFromR2: mocks.downloadFromR2,
}));

import { readCertificateImage } from "./certificate-input-images";

const STORAGE = {
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
  R2_BUCKET_NAME: "documents-bucket",
  R2_MEDIA_BUCKET_NAME: "media-bucket",
};
const BYTES = new Uint8Array([1, 2, 3]);

function noSuchKey() {
  const error = new Error("The specified key does not exist.");
  error.name = "NoSuchKey";
  return error;
}

beforeEach(() => {
  mocks.env.value = STORAGE;
  mocks.downloadFromR2.mockReset();
});

describe("REQ-CIN-1: reading the images a certificate embeds", () => {
  it("REQ-CIN-1 returns the object's bytes from the media bucket", async () => {
    mocks.downloadFromR2.mockResolvedValueOnce(BYTES);

    await expect(readCertificateImage("org/logo")).resolves.toBe(BYTES);

    expect(mocks.downloadFromR2).toHaveBeenCalledTimes(1);
    expect(mocks.downloadFromR2).toHaveBeenCalledWith(
      expect.anything(),
      "media-bucket",
      "org/logo",
    );
  });

  it("REQ-CIN-1 falls back to the documents bucket for an object not yet moved by the bucket split", async () => {
    mocks.downloadFromR2
      .mockRejectedValueOnce(noSuchKey())
      .mockResolvedValueOnce(BYTES);

    await expect(readCertificateImage("org/logo")).resolves.toBe(BYTES);

    expect(mocks.downloadFromR2).toHaveBeenLastCalledWith(
      expect.anything(),
      "documents-bucket",
      "org/logo",
    );
  });

  it("REQ-CIN-1 no object in either bucket reads as absent, not as a failure", async () => {
    mocks.downloadFromR2.mockRejectedValue(noSuchKey());

    await expect(readCertificateImage("org/logo")).resolves.toBeNull();
  });

  it("REQ-CIN-1 [HIGH RISK] a storage failure is thrown, so the approval fails and is retried instead of freezing a certificate without its image", async () => {
    mocks.downloadFromR2.mockRejectedValue(new Error("connection reset"));

    await expect(readCertificateImage("org/logo")).rejects.toThrow(
      "connection reset",
    );
  });

  it("REQ-CIN-1 without configured storage nothing is read (a development setup without a bucket)", async () => {
    mocks.env.value = null;

    await expect(readCertificateImage("org/logo")).resolves.toBeNull();
    expect(mocks.downloadFromR2).not.toHaveBeenCalled();
  });
});
