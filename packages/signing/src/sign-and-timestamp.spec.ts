import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

import { SigningError } from "./types.js";

/**
 * signAndTimestampPdf — the PAdES-T orchestration (issue #646 / CMP-03).
 *
 * REQ-CMP-LTV-001: with a TSA configured, the signer embeds an RFC 3161
 *                  timestamp and the metadata reflects it (incl. the honest
 *                  icpBrasilConformant flag and a pdfHash recomputed over the
 *                  FINAL timestamped bytes — the artifact that gets stored).
 * REQ-CMP-LTV-003: TSA configured but stamping fails => SigningError
 *                  TIMESTAMP_FAILED (fail closed; never silently emit an
 *                  unstamped certificate).
 *
 * signPdf and pdf-rfc3161 are mocked: the real signer is covered by
 * signer.spec.ts and the live TSA round-trip is integration-only.
 */
const SIGNED_BYTES = new Uint8Array([1, 2, 3, 4]);
const STAMPED_BYTES = new Uint8Array([1, 2, 3, 4, 9, 9]);

const signPdfMock = vi.hoisted(() => vi.fn());
const timestampPdfMock = vi.hoisted(() => vi.fn());

vi.mock("./signer.js", () => ({ signPdf: signPdfMock }));
vi.mock("pdf-rfc3161", () => ({ timestampPdf: timestampPdfMock }));

const { signAndTimestampPdf } = await import("./sign-and-timestamp.js");

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const BASE_SIGN_RESULT = {
  signedPdf: SIGNED_BYTES,
  metadata: {
    signedAt: "2026-07-05T12:00:00.000Z",
    signerCertificateSerial: "01",
    signerName: "Lab Teste",
    signerCpfCnpj: null,
    pdfHash: sha256Hex(SIGNED_BYTES),
    ltvEnabled: false,
  },
};

const SIGN_OPTIONS = {
  p12Buffer: Buffer.from("p12"),
  password: "pw",
  reason: "Certificado de Calibracao",
};

beforeEach(() => {
  signPdfMock.mockReset();
  timestampPdfMock.mockReset();
  signPdfMock.mockResolvedValue({
    ...BASE_SIGN_RESULT,
    metadata: { ...BASE_SIGN_RESULT.metadata },
  });
});

describe("signAndTimestampPdf", () => {
  it("without a TSA config, returns the plain signPdf result and never calls the TSA", async () => {
    const result = await signAndTimestampPdf(Buffer.from("pdf"), SIGN_OPTIONS);

    expect(result.signedPdf).toBe(SIGNED_BYTES);
    expect(result.metadata.pdfHash).toBe(sha256Hex(SIGNED_BYTES));
    expect(result.metadata.timestamped).toBeUndefined();
    expect(timestampPdfMock).not.toHaveBeenCalled();
  });

  it("REQ-CMP-LTV-001: with a TSA config, stamps the signed PDF, recomputes pdfHash over the FINAL bytes and records the conformance flag", async () => {
    timestampPdfMock.mockResolvedValue({ pdf: STAMPED_BYTES });

    const result = await signAndTimestampPdf(Buffer.from("pdf"), {
      ...SIGN_OPTIONS,
      timestamp: {
        tsaUrl: "https://act.example/tsa",
        headers: { Authorization: "Basic abc" },
        icpBrasilConformant: true,
      },
    });

    expect(result.signedPdf).toBe(STAMPED_BYTES);
    // The stored hash must describe the artifact that is uploaded/verified —
    // the TIMESTAMPED bytes, not the pre-stamp signature.
    expect(result.metadata.pdfHash).toBe(sha256Hex(STAMPED_BYTES));
    expect(result.metadata.timestamped).toBe(true);
    expect(result.metadata.timestampIcpBrasilConformant).toBe(true);

    // The TSA endpoint + auth headers flow through to pdf-rfc3161.
    expect(timestampPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tsa: expect.objectContaining({
          url: "https://act.example/tsa",
          headers: { Authorization: "Basic abc" },
        }),
      }),
    );
  });

  it("records icpBrasilConformant=false for a generic (non-ACT) TSA — honest labeling", async () => {
    timestampPdfMock.mockResolvedValue({ pdf: STAMPED_BYTES });

    const result = await signAndTimestampPdf(Buffer.from("pdf"), {
      ...SIGN_OPTIONS,
      timestamp: { tsaUrl: "https://freetsa.example" },
    });

    expect(result.metadata.timestamped).toBe(true);
    expect(result.metadata.timestampIcpBrasilConformant).toBe(false);
  });

  it("REQ-CMP-LTV-003: TSA configured but stamping fails => SigningError TIMESTAMP_FAILED (fail closed)", async () => {
    timestampPdfMock.mockRejectedValue(new Error("TSA HTTP 503"));

    const attempt = signAndTimestampPdf(Buffer.from("pdf"), {
      ...SIGN_OPTIONS,
      timestamp: { tsaUrl: "https://act.example/tsa" },
    });

    await expect(attempt).rejects.toMatchObject({
      name: "SigningError",
      code: "TIMESTAMP_FAILED",
    });
    await expect(attempt).rejects.toBeInstanceOf(SigningError);
  });
});
