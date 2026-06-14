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
