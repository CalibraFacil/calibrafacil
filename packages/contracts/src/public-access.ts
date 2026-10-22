import { z } from "zod";
import {
  PublicServiceOrderAccessViewSchema,
  RedeemServiceOrderAccessCodeResponseSchema,
} from "@calibra-facil/schemas";

import { nullableString } from "./common";

/**
 * Response contracts for the unauthenticated endpoints the portal calls: the
 * public certificate verification (`/api/verify/:token*`), the portal invitation
 * lookup (`/api/invitations/:token`) and the magic-link preview. Wire schemas
 * (see `jobs.ts`): validate only, unknown keys allowed.
 */

const verificationLinkSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  verificationToken: z.string(),
});

const digitalSignatureSchema = z.discriminatedUnion("signed", [
  z.object({
    signed: z.literal(true),
    signedAt: nullableString,
    signerName: nullableString,
    signerCpfCnpj: nullableString,
    certificateSerial: nullableString,
    pdfHash: nullableString,
    ltvEnabled: z.boolean().nullable(),
  }),
  z.object({ signed: z.literal(false) }),
]);

/** GET /api/verify/:token */
export const verificationResponseSchema = z.object({
  valid: z.literal(true),
  jobId: z.string(),
  status: z.string(),
  hasDocument: z.boolean(),
  lab: z.string(),
  accreditation: z
    .object({ accredited: z.boolean(), number: nullableString })
    .optional(),
  customer: z.string(),
  asset: z.object({ name: z.string(), tag: nullableString }),
  service: z.string(),
  performedAt: nullableString,
  approvedAt: nullableString,
  // Digital signature: ISO/IEC 17025 Clause 7.8.2.1(q)
  digitalSignature: digitalSignatureSchema,
  // Amendment lineage: ISO/IEC 17025 Clause 7.8.4.1
  isSuperseded: z.boolean(),
  isAmendment: z.boolean(),
  amendmentNumber: z.number().nullable(),
  amendmentReason: nullableString,
  supersededAt: nullableString,
  supersededBy: verificationLinkSchema.nullable(),
  supersedes: verificationLinkSchema.nullable(),
});
export type VerificationResponse = z.infer<typeof verificationResponseSchema>;

const verdictSignerSchema = z.object({
  commonName: nullableString,
  cpfCnpj: nullableString,
  certificateSerial: nullableString,
});

export const signatureVerdictSchema = z.object({
  hashMatch: z.boolean().nullable(),
  signatureCryptographicallyValid: z.boolean(),
  chainValid: z.boolean(),
  signerChainsToIcpRoot: z.boolean(),
  certNotExpiredAtCheckDate: z.boolean(),
  signaturePresent: z.boolean(),
  // #646 (PAdES-T): verdicts stored before the time-stamp feature omit these.
  timestampPresent: z.boolean().optional(),
  timestamp: z
    .object({ time: nullableString, tsaCommonName: nullableString })
    .nullable()
    .optional(),
  revocationChecked: z.boolean().optional(),
  certificateRevoked: z.boolean().nullable().optional(),
  revocationTime: nullableString.optional(),
  signer: verdictSignerSchema,
  overall: z.enum(["VALID", "ALTERED", "UNSIGNED", "REVOKED", "UNVERIFIABLE"]),
  details: z.array(z.string()),
});
export type SignatureVerdictResponse = z.infer<typeof signatureVerdictSchema>;

/** GET /api/verify/:token/signature */
export const signatureVerificationResponseSchema = z.object({
  signed: z.boolean(),
  source: z.enum(["issue", "live"]).nullable(),
  computedAt: nullableString,
  verdict: signatureVerdictSchema.nullable(),
});
export type SignatureVerificationResponse = z.infer<
  typeof signatureVerificationResponseSchema
>;

/** POST /api/verify/:token/match */
export const verificationMatchResponseSchema = z.object({
  match: z.boolean(),
  expectedSha256: z.string(),
  uploadedSha256: z.string(),
  uploadedVerdict: signatureVerdictSchema,
});
export type VerificationMatchResponse = z.infer<
  typeof verificationMatchResponseSchema
>;

/** GET /api/verify/:token/download */
export const verificationDownloadResponseSchema = z.object({ url: z.string() });

/** GET /api/invitations/:token */
export const invitationLookupResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  inviterEmail: z.string(),
});
export type InvitationLookupResponse = z.infer<
  typeof invitationLookupResponseSchema
>;

/** GET /api/magic-link/preview */
export const magicLinkPreviewResponseSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    name: z.string(),
    email: z.string(),
    image: nullableString,
    organizationName: nullableString,
    organizationLogo: nullableString,
  }),
]);
export type MagicLinkPreviewResponse = z.infer<
  typeof magicLinkPreviewResponseSchema
>;

/** GET /api/public/service-order-access/:token */
export const publicServiceOrderAccessResponseSchema = z.object({
  data: PublicServiceOrderAccessViewSchema,
});

/** POST /api/public/service-order-access/redeem-code */
export const publicServiceOrderRedeemResponseSchema =
  RedeemServiceOrderAccessCodeResponseSchema;
