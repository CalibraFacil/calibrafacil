import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The member's own visual signature (a PNG stamped on the certificates they
 * approve). Response schemas are wire schemas written from what
 * `apps/api/src/domains/org/routes/signatures.ts` returns.
 *
 * Not client-facing, so not defined here: `GET /member/:memberId` (certificate
 * generation reads it server-side).
 */

const signatureDimensionsSchema = z.object({
  width: z.number(),
  height: z.number(),
});

/** GET /api/signatures/my-signature: absent (`hasSignature: false`) or the presigned URL and size. */
export const mySignatureResponseSchema = z.union([
  z.object({ hasSignature: z.literal(false) }),
  z.object({
    hasSignature: z.literal(true),
    url: z.string(),
    dimensions: signatureDimensionsSchema,
    uploadedAt: z.string().nullable().optional(),
  }),
]);
export type MySignatureResponse = z.infer<typeof mySignatureResponseSchema>;

/** POST /api/signatures/my-signature */
export const signatureUploadResponseSchema = z.object({
  message: z.string(),
  dimensions: signatureDimensionsSchema,
});
export type SignatureUploadResponse = z.infer<
  typeof signatureUploadResponseSchema
>;

const DESKTOP_LABEL = "Assinatura visual";

export const signatureEndpoints = {
  getMine: endpoint({
    method: "get",
    path: "/api/signatures/my-signature",
    response: mySignatureResponseSchema,
    failure: "Failed to fetch signature",
    // The desktop answers "no signature" locally instead (`desktop-client.ts`).
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
    permission: { calibration: ["read"] },
  }),
  // A multipart upload: the definition carries no `body` (the handler reads the
  // form itself) and the SDK overrides this method with the file upload
  // (`client-runtime/src/modules/signatures.ts`).
  uploadMine: endpoint({
    method: "post",
    path: "/api/signatures/my-signature",
    response: signatureUploadResponseSchema,
    failure: "Upload failed",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
    permission: { calibration: ["read"] },
  }),
  deleteMine: endpoint({
    method: "delete",
    path: "/api/signatures/my-signature",
    response: z.object({ message: z.string() }),
    failure: "Failed to delete signature",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
    permission: { calibration: ["read"] },
  }),
} as const satisfies EndpointGroup;
