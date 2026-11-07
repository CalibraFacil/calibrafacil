import { z } from "zod";
import {
  UpdateCertificateNumberingProfileSchema,
  CertificateSequenceResetScopeSchema,
} from "@calibra-facil/schemas";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's certificate-numbering profile (number format, name
 * convention, sequence). Response schemas are wire schemas written from what
 * `apps/api/src/domains/jobs/routes/certificate-numbering.ts` returns.
 *
 * Not client-facing, so not defined here: `GET /audit-log` (no SDK method).
 * Cloud-only: the desktop shows a fixed default profile instead
 * (`desktop-client.ts`), it never reads or writes the real one.
 */

const certificateNumberingConfigSchema = z.object({
  labCode: z.string(),
  projectCode: nullableString.optional(),
  numberTemplate: z.string(),
  certificateNameTemplate: z.string(),
  sequence: z.object({
    resetScope: CertificateSequenceResetScopeSchema,
    startAt: z.number(),
    increment: z.number(),
    padding: z.number(),
  }),
});
export type CertificateNumberingConfig = z.infer<
  typeof certificateNumberingConfigSchema
>;

/** GET /api/certificate-numbering: the stored profile, or the default one (`id` null) when none is saved. */
export const certificateNumberingProfileResponseSchema = z.object({
  profile: z.object({
    id: z.number().nullable(),
    name: z.string(),
    config: certificateNumberingConfigSchema,
    createdAt: nullableString,
    updatedAt: nullableString,
  }),
  example: z.object({
    number: z.string(),
    name: z.string(),
    sequenceKey: z.string(),
  }),
  supportedTokens: z.array(z.string()),
});
export type CertificateNumberingProfileResponse = z.infer<
  typeof certificateNumberingProfileResponseSchema
>;

/** PUT /api/certificate-numbering */
export const updateCertificateNumberingProfileResponseSchema = z.object({
  message: z.string(),
  profile: z.object({
    id: z.number(),
    name: z.string(),
    config: certificateNumberingConfigSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});
export type UpdateCertificateNumberingProfileResponse = z.infer<
  typeof updateCertificateNumberingProfileResponseSchema
>;

const DESKTOP_LABEL = "Numeração de certificados";

export const certificateNumberingEndpoints = {
  getProfile: endpoint({
    method: "get",
    path: "/api/certificate-numbering",
    response: certificateNumberingProfileResponseSchema,
    failure: "Falha ao carregar perfil de numeração",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateProfile: endpoint({
    method: "put",
    path: "/api/certificate-numbering",
    body: UpdateCertificateNumberingProfileSchema,
    response: updateCertificateNumberingProfileResponseSchema,
    failure: "Falha ao salvar perfil",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
