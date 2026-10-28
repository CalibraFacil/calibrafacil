import { z } from "zod";
import {
  ReferenceStandardKindSchema,
  ReferenceStandardStatusSchema,
  UncertaintyDistributionSchema,
} from "@calibra-facil/schemas";

import { nullableNumber, nullableString, paginationSchema } from "./common";
import { certifiedValueSchema, metrologyDataSchema } from "./jobs";

/**
 * Response contracts for the reference-standards endpoints
 * (`/api/standards/*`). Wire schemas (see `jobs.ts` for the rules): every
 * timestamp / calendar day is an ISO string, nothing here changes API output,
 * and the desktop local-server serves the very same shapes from its offline
 * mirror (`apps/local-server` contract tests parse them with these schemas).
 */

export const standardStatusSchema = ReferenceStandardStatusSchema;
export type StandardStatus = z.infer<typeof standardStatusSchema>;

/** The original certificate PDF of a standard (current version). */
export const standardCertificateDocumentSchema = z.object({
  documentId: z.number(),
  r2Key: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  sha256: z.string(),
  uploadedAt: z.string(),
  certificateNumber: z.string(),
  calibrationDate: z.string(),
  nextCalibrationDate: z.string(),
});
export type StandardCertificateDocument = z.infer<
  typeof standardCertificateDocumentSchema
>;

/** A mass composition profile attached to a standard's metrology data. */
export const standardCompositionProfileSchema = z.object({
  profileKey: z.string(),
  profileClass: nullableString.optional(),
  nominal: z.string(),
  value: z.number(),
  uncertainty: z.number(),
  unit: z.string(),
  maxError: nullableNumber.optional(),
  drift: nullableNumber.optional(),
  buoyancy: nullableNumber.optional(),
  coverageFactor: nullableNumber.optional(),
  quantityAvailable: nullableNumber.optional(),
});

/**
 * Metrology data of a standard. Same wire shape as the one frozen into a job's
 * standards snapshot, with the composition profiles typed.
 */
export const standardMetrologyDataSchema = metrologyDataSchema.extend({
  compositionProfiles: z.array(standardCompositionProfileSchema),
});

/**
 * The stored reference standard: what POST / (create) and PUT /:id (update)
 * answer with, and the common core of the list item and the detail.
 */
export const standardRecordSchema = z.object({
  id: z.number(),
  name: z.string(),
  kind: ReferenceStandardKindSchema,
  type: nullableString,
  serialNumber: z.string(),
  manufacturer: nullableString,
  model: nullableString,
  certificateNumber: z.string(),
  calibratedBy: nullableString,
  /** Roadmap 2 C2: the provider's accreditation, evidence for the SI-traceability sentence. */
  // The provider's accreditation (roadmap 2 C2): cloud data only; the desktop
  // local server's standards carry none (absent there, never asserted).
  calibrationProviderAccreditationNumber: nullableString.optional(),
  calibrationProviderMraRecognized: z.boolean().optional(),
  calibrationDate: z.string(),
  nextCalibrationDate: z.string(),
  referenceValue: nullableNumber,
  uncertainty: nullableNumber,
  uncertaintyUnit: nullableString,
  coverageFactor: z.number(),
  distribution: UncertaintyDistributionSchema,
  drift: nullableNumber,
  certifiedValues: z.array(certifiedValueSchema).nullable(),
  metrologyData: standardMetrologyDataSchema.nullable(),
  status: standardStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StandardRecord = z.infer<typeof standardRecordSchema>;

/**
 * A standard as GET / lists it and GET /:id returns it: the record plus the
 * current certificate document and the validity verdict (calendar days in
 * laboratory time; valid THROUGH the certificate day).
 */
export const standardSchema = standardRecordSchema.extend({
  certificateDocument: standardCertificateDocumentSchema.nullable().optional(),
  isExpired: z.boolean(),
  daysUntilExpiry: z.number(),
});
export type Standard = z.infer<typeof standardSchema>;

/** GET /api/standards */
export const standardsListResponseSchema = z.object({
  data: z.array(standardSchema),
  pagination: paginationSchema,
});
export type StandardsListResponse = z.infer<typeof standardsListResponseSchema>;

/** POST /api/standards/:id/certificate-document */
export const standardCertificateDocumentUploadResponseSchema = z.object({
  message: z.string(),
  document: standardCertificateDocumentSchema,
});
export type StandardCertificateDocumentUploadResponse = z.infer<
  typeof standardCertificateDocumentUploadResponseSchema
>;

/** GET /api/standards/:id/certificate-document/download */
export const standardCertificateDocumentDownloadResponseSchema = z.object({
  url: z.string(),
  filename: z.string(),
});
export type StandardCertificateDocumentDownloadResponse = z.infer<
  typeof standardCertificateDocumentDownloadResponseSchema
>;

/** A row of the normalized mass composition-profile catalog. */
export const massCompositionProfileSchema = z.object({
  id: z.number(),
  profileKey: z.string(),
  profileClass: z.string(),
  nominal: z.string(),
  nominalG: z.number(),
  value: z.number(),
  uncertainty: z.number(),
  unit: z.string(),
  maxError: nullableNumber,
  drift: nullableNumber,
  buoyancy: nullableNumber,
  coverageFactor: nullableNumber,
  quantityAvailable: nullableNumber,
});
export type MassCompositionProfile = z.infer<
  typeof massCompositionProfileSchema
>;

/** GET /api/standards/composition-profiles */
export const massCompositionProfilesResponseSchema = z.object({
  data: z.array(massCompositionProfileSchema),
});
export type MassCompositionProfilesResponse = z.infer<
  typeof massCompositionProfilesResponseSchema
>;
