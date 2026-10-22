import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const env: { value: Record<string, string> | null } = { value: null };
  const runtime = { isProduction: false };
  return { env, runtime, downloadFromR2: vi.fn() };
});

vi.mock("@calibra-facil/config", () => ({
  readRuntimeConfig: () => ({ isProduction: mocks.runtime.isProduction }),
}));

vi.mock("./storage", () => ({
  r2EnvFromStorageConfig: () => mocks.env.value,
  createR2Client: () => ({}),
  resolveBucketName: (
    env: { R2_BUCKET_NAME: string; R2_MEDIA_BUCKET_NAME: string },
    bucket: "media" | "documents",
  ) => (bucket === "media" ? env.R2_MEDIA_BUCKET_NAME : env.R2_BUCKET_NAME),
  downloadFromR2: mocks.downloadFromR2,
}));

import {
  CERTIFICATE_IMAGE_READ_TIMEOUT_MS,
  CertificateImageStorageError,
  readCertificateImage,
} from "./certificate-input-images";

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

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.runtime.isProduction = false;
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

  it("REQ-CIN-1 without configured storage nothing is read in development and test (no bucket on a laptop)", async () => {
    mocks.env.value = null;
    mocks.runtime.isProduction = false;

    await expect(readCertificateImage("org/logo")).resolves.toBeNull();
    expect(mocks.downloadFromR2).not.toHaveBeenCalled();
  });

  it("REQ-CIN-1 [HIGH RISK] without configured storage in production an image that exists cannot be read: the approval fails instead of freezing the certificate without it", async () => {
    mocks.env.value = null;
    mocks.runtime.isProduction = true;

    await expect(readCertificateImage("org/logo")).rejects.toBeInstanceOf(
      CertificateImageStorageError,
    );
    expect(mocks.downloadFromR2).not.toHaveBeenCalled();
  });

  it("REQ-CIN-1 [HIGH RISK] a stalled storage read gives up after the timeout and fails the approval instead of hanging it", async () => {
    vi.useFakeTimers();
    mocks.downloadFromR2.mockReturnValue(new Promise<never>(() => undefined));

    const read = readCertificateImage("org/logo");
    const outcome = expect(read).rejects.toThrow(/took longer than/);
    await vi.advanceTimersByTimeAsync(CERTIFICATE_IMAGE_READ_TIMEOUT_MS + 1);

    await outcome;
    await expect(read).rejects.toBeInstanceOf(CertificateImageStorageError);
    // one stalled call: the other bucket is not tried after a timeout
    expect(mocks.downloadFromR2).toHaveBeenCalledTimes(1);
  });

  it("REQ-CIN-1 a read that completes in time does not leave its timer running", async () => {
    vi.useFakeTimers();
    mocks.downloadFromR2.mockResolvedValueOnce(BYTES);

    await expect(readCertificateImage("org/logo")).resolves.toBe(BYTES);

    expect(vi.getTimerCount()).toBe(0);
  });
});
