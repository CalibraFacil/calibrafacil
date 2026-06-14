import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getApiBaseUrl } from "@/lib/utils";

/**
 * Public certificate verification — the unauthenticated `/v/:token` page.
 *
 * Talks to the public `/api/verify/:token` endpoint (no session cookie). The
 * token is the opaque `calibrationJob.verificationToken` UUID embedded in the
 * certificate QR code; unknown/invalid tokens come back as 400/404 and surface
 * as a clear "not found" state rather than an error toast.
 */

const verificationLinkSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  verificationToken: z.string(),
});

const digitalSignatureSchema = z.discriminatedUnion("signed", [
  z.object({
    signed: z.literal(true),
    signedAt: z.string().nullable(),
    signerName: z.string().nullable(),
    signerCpfCnpj: z.string().nullable(),
    certificateSerial: z.string().nullable(),
    pdfHash: z.string().nullable(),
    ltvEnabled: z.boolean().nullable(),
  }),
  z.object({ signed: z.literal(false) }),
]);

/** Mirrors the `verifyRouter` `GET /:token` response (apps/api/src/routes/verify.ts). */
const verificationSchema = z.object({
  valid: z.literal(true),
  jobId: z.string(),
  status: z.string(),
  hasDocument: z.boolean(),
  lab: z.string(),
  accreditation: z
    .object({ accredited: z.boolean(), number: z.string().nullable() })
    .optional(),
  customer: z.string(),
  asset: z.object({ name: z.string(), tag: z.string().nullable() }),
  service: z.string(),
  performedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  // Digital signature — ISO/IEC 17025 Clause 7.8.2.1(q)
  digitalSignature: digitalSignatureSchema,
  // Amendment lineage — ISO/IEC 17025 Clause 7.8.4.1
  isSuperseded: z.boolean(),
  isAmendment: z.boolean(),
  amendmentNumber: z.number().nullable(),
  amendmentReason: z.string().nullable(),
  supersededAt: z.string().nullable(),
  supersededBy: verificationLinkSchema.nullable(),
  supersedes: verificationLinkSchema.nullable(),
});

export type VerificationData = z.infer<typeof verificationSchema>;

/** A token that is well-formed but resolves to no publicly verifiable certificate. */
export class CertificateNotFoundError extends Error {
  constructor() {
    super("Certificado não encontrado ou inválido.");
    this.name = "CertificateNotFoundError";
  }
}

async function fetchVerification(token: string): Promise<VerificationData> {
  const response = await fetch(`${getApiBaseUrl()}/api/verify/${token}`);

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      throw new CertificateNotFoundError();
    }
    throw new Error("Erro ao verificar certificado.");
  }

  const parsed = verificationSchema.safeParse(await response.json());
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

const verdictSignerSchema = z.object({
  commonName: z.string().nullable(),
  cpfCnpj: z.string().nullable(),
  certificateSerial: z.string().nullable(),
});

const signatureVerdictSchema = z.object({
  hashMatch: z.boolean().nullable(),
  signatureCryptographicallyValid: z.boolean(),
  chainValid: z.boolean(),
  signerChainsToIcpRoot: z.boolean(),
  certNotExpiredAtCheckDate: z.boolean(),
  signaturePresent: z.boolean(),
  signer: verdictSignerSchema,
  overall: z.enum(["VALID", "ALTERED", "UNSIGNED", "UNVERIFIABLE"]),
  details: z.array(z.string()),
});

const signatureVerificationSchema = z.object({
  signed: z.boolean(),
  source: z.enum(["issue", "live"]).nullable(),
  computedAt: z.string().nullable(),
  verdict: signatureVerdictSchema.nullable(),
});

export type SignatureVerdict = z.infer<typeof signatureVerdictSchema>;
export type SignatureVerdictOverall = SignatureVerdict["overall"];
export type SignatureVerification = z.infer<typeof signatureVerificationSchema>;

async function fetchSignatureVerification(
  token: string,
): Promise<SignatureVerification> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/verify/${token}/signature`,
  );
  if (!response.ok) {
    throw new Error("Erro ao verificar a assinatura.");
  }
  const parsed = signatureVerificationSchema.safeParse(await response.json());
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

const matchResultSchema = z.object({
  match: z.boolean(),
  expectedSha256: z.string(),
  uploadedSha256: z.string(),
  uploadedVerdict: signatureVerdictSchema,
});

export type CertificateMatchResult = z.infer<typeof matchResultSchema>;

/** Upload a PDF and check it byte-for-byte against this certificate's record. */
export async function matchCertificateUpload(
  token: string,
  file: File,
): Promise<CertificateMatchResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${getApiBaseUrl()}/api/verify/${token}/match`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error("Não foi possível conferir o arquivo.");
  }
  const parsed = matchResultSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Resposta de conferência inválida.");
  }
  return parsed.data;
}

/** Resolves the public download URL (presigned R2) for the signed certificate PDF. */
export async function fetchCertificateDownloadUrl(
  token: string,
): Promise<string> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/verify/${token}/download`,
  );
  if (!response.ok) {
    throw new Error("Erro ao baixar certificado");
  }
  const parsed = z.object({ url: z.string() }).safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Erro ao baixar certificado");
  }
  return parsed.data.url;
}
