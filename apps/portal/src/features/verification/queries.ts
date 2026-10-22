import { useQuery } from "@tanstack/react-query";
import {
  signatureVerificationResponseSchema,
  verificationDownloadResponseSchema,
  verificationMatchResponseSchema,
  verificationResponseSchema,
  type SignatureVerdictResponse,
  type SignatureVerificationResponse,
  type VerificationMatchResponse,
  type VerificationResponse,
} from "@calibra-facil/contracts";

import { fetchPortalResponse, readPortalJsonResult } from "@/lib/api-fetch";

/**
 * Public certificate verification — the unauthenticated `/v/:token` page.
 *
 * Talks to the public `/api/verify/:token` endpoint (no session cookie). The
 * token is the opaque `calibrationJob.verificationToken` UUID embedded in the
 * certificate QR code; unknown/invalid tokens come back as 400/404 and surface
 * as a clear "not found" state rather than an error toast.
 */

export type VerificationData = VerificationResponse;

/** A token that is well-formed but resolves to no publicly verifiable certificate. */
export class CertificateNotFoundError extends Error {
  constructor() {
    super("Certificado não encontrado ou inválido.");
    this.name = "CertificateNotFoundError";
  }
}

async function fetchVerification(token: string): Promise<VerificationData> {
  const response = await fetchPortalResponse(`/api/verify/${token}`, {
    credentials: "omit",
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      throw new CertificateNotFoundError();
    }
    throw new Error("Erro ao verificar certificado.");
  }

  const parsed = await readPortalJsonResult(
    response,
    verificationResponseSchema,
  );
  if (!parsed.success) {
    // Either `valid: false` or an unexpected shape — treat as not verifiable.
    throw new CertificateNotFoundError();
  }

  return parsed.data;
}

export function useVerification(token: string) {
  return useQuery({
    queryKey: ["verification", token],
    queryFn: () => fetchVerification(token),
    retry: false,
  });
}

// — Signature integrity (Phase 1) — `/api/verify/:token/signature` —————————————

export type SignatureVerdict = SignatureVerdictResponse;
export type SignatureVerdictOverall = SignatureVerdict["overall"];
export type SignatureVerification = SignatureVerificationResponse;

async function fetchSignatureVerification(
  token: string,
): Promise<SignatureVerification> {
  const response = await fetchPortalResponse(`/api/verify/${token}/signature`, {
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error("Erro ao verificar a assinatura.");
  }
  const parsed = await readPortalJsonResult(
    response,
    signatureVerificationResponseSchema,
  );
  if (!parsed.success) {
    throw new Error("Resposta de verificação inválida.");
  }
  return parsed.data;
}

/**
 * Lazily resolves the signature-integrity verdict. `enabled` gates the request
 * to certificates that actually carry a digital signature.
 */
export function useSignatureVerdict(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ["verification-signature", token],
    queryFn: () => fetchSignatureVerification(token),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// — Upload-to-verify (Phase 2) — `POST /api/verify/:token/match` ——————————————

export type CertificateMatchResult = VerificationMatchResponse;

/** Upload a PDF and check it byte-for-byte against this certificate's record. */
export async function matchCertificateUpload(
  token: string,
  file: File,
): Promise<CertificateMatchResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetchPortalResponse(`/api/verify/${token}/match`, {
    credentials: "omit",
    init: { method: "POST", body },
  });
  if (!response.ok) {
    throw new Error("Não foi possível conferir o arquivo.");
  }
  const parsed = await readPortalJsonResult(
    response,
    verificationMatchResponseSchema,
  );
  if (!parsed.success) {
    throw new Error("Resposta de conferência inválida.");
  }
  return parsed.data;
}

/** Resolves the public download URL (presigned R2) for the signed certificate PDF. */
export async function fetchCertificateDownloadUrl(
  token: string,
): Promise<string> {
  const response = await fetchPortalResponse(`/api/verify/${token}/download`, {
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error("Erro ao baixar certificado");
  }
  const parsed = await readPortalJsonResult(
    response,
    verificationDownloadResponseSchema,
  );
  if (!parsed.success) {
    throw new Error("Erro ao baixar certificado");
  }
  return parsed.data.url;
}
