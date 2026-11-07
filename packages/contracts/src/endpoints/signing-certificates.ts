import { z } from "zod";
import { UnsignedIssuanceSettingSchema } from "@calibra-facil/schemas";

import { nullableString, unitContextSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The unit's ICP-Brasil signing certificates and its signing policy. Response
 * schemas are wire schemas written from what `apps/api/src/domains/org/routes/signing.ts`
 * returns. Cloud-only: the desktop never reads or writes them
 * (`desktop-client.ts`).
 *
 * Not client-facing, so not defined here: `GET /certificates/:id` (no SDK
 * method).
 */

export const UploadSigningCertificateSchema = z.object({
  name: z.string().min(1).max(100),
  p12Base64: z.string().min(1), // Base64-encoded PKCS#12 file
  password: z.string().min(1),
  setAsDefault: z.boolean().optional().default(false),
});

export const RevokeSigningCertificateSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const SigningPolicySchema = z.object({ requireSignature: z.boolean() });

const certificateIdParams = z.object({ id: routeId });

const signingCertificateSchema = z.object({
  id: z.number(),
  unitId: z.number(),
  name: z.string(),
  serialNumber: z.string(),
  issuerCn: z.string(),
  subjectCn: z.string(),
  subjectCpfCnpj: nullableString.optional(),
  validFrom: z.string(),
  validUntil: z.string(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  createdByName: nullableString,
  revokedAt: nullableString,
  revokedReason: nullableString,
  status: z.enum(["valid", "expired", "not_yet_valid", "revoked"]),
});

/** The unit's explicit "emitir sem assinatura digital" setting; `reason` is mandatory while enabled. */
const unsignedIssuanceSchema = z.object({
  enabled: z.boolean(),
  reason: nullableString,
  setAt: nullableString.optional(),
  setByName: nullableString.optional(),
});
export type UnsignedIssuanceSetting = z.infer<typeof unsignedIssuanceSchema>;

/** GET /api/signing/certificates: the unit's certificates, with its signing policy riding along. */
export const signingCertificatesListResponseSchema = z.object({
  certificates: z.array(signingCertificateSchema),
  unit: unitContextSchema,
  /** The unit's "assinatura obrigatória" policy flag. */
  requireSignature: z.boolean(),
  unsignedIssuance: unsignedIssuanceSchema,
});
export type SigningCertificatesListResponse = z.infer<
  typeof signingCertificatesListResponseSchema
>;
export type SigningCertificate =
  SigningCertificatesListResponse["certificates"][number];

const messageResponseSchema = z.object({ message: z.string() });

const DESKTOP_LABEL = "Certificado ICP-Brasil";

export const signingCertificateEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/signing/certificates",
    response: signingCertificatesListResponseSchema,
    failure: "Failed to fetch certificates",
    // The desktop answers no certificates locally (`desktop-client.ts`).
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
  upload: endpoint({
    method: "post",
    path: "/api/signing/certificates",
    body: UploadSigningCertificateSchema,
    response: z.object({
      message: z.string(),
      certificate: z.object({
        id: z.number(),
        unitId: z.number(),
        name: z.string(),
        serialNumber: z.string(),
        issuerCn: z.string(),
        subjectCn: z.string(),
        validFrom: z.string(),
        validUntil: z.string(),
        isDefault: z.boolean(),
      }),
    }),
    failure: "Upload failed",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
  setDefault: endpoint({
    method: "post",
    path: "/api/signing/certificates/:id/set-default",
    params: certificateIdParams,
    response: messageResponseSchema,
    failure: "Failed to set default",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
  revoke: endpoint({
    method: "delete",
    path: "/api/signing/certificates/:id",
    params: certificateIdParams,
    body: RevokeSigningCertificateSchema,
    response: messageResponseSchema,
    failure: "Failed to revoke",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
  /** The unit's "assinatura obrigatória" policy. */
  setPolicy: endpoint({
    method: "patch",
    path: "/api/signing/policy",
    body: SigningPolicySchema,
    response: z.object({ requireSignature: z.boolean() }),
    failure: "Failed to update signing policy",
    policy: "cloud-only",
    desktopLabel: "Política de assinatura",
    desktopFlavor: "cloud-sync",
  }),
  /** Admin and owner only; enabling needs a reason. */
  setUnsignedIssuance: endpoint({
    method: "patch",
    path: "/api/signing/unsigned-issuance",
    body: UnsignedIssuanceSettingSchema,
    response: z.object({ unsignedIssuance: unsignedIssuanceSchema }),
    failure: "Failed to update unsigned issuance",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
} as const satisfies EndpointGroup;
