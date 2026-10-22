import { z } from "zod";

import { nullableNumber, nullableString, paginationSchema } from "./common";

/**
 * Response contracts for the portal's certificate endpoints
 * (`/api/portal/certificates*`, `/api/portal/audit-packs*`). Wire schemas (see
 * `jobs.ts`): validate only, unknown keys allowed, timestamps are ISO strings.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());
const releaseStatusSchema = z.enum(["RELEASED", "PAYMENT_PENDING"]);

/** One row of GET /api/portal/certificates. */
export const portalCertificateListItemSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  certificateName: nullableString,
  status: z.string(),
  performedAt: nullableString,
  approvedAt: nullableString,
  certificateUrl: nullableString,
  verificationToken: z.string(),
  amendmentNumber: nullableNumber,
  assetId: z.number(),
  assetPublicId: z.string(),
  assetName: z.string(),
  assetTag: z.string(),
  assetManufacturer: nullableString,
  assetModel: nullableString,
  assetSerialNumber: z.string(),
  serviceName: z.string(),
  labName: z.string(),
  releaseStatus: releaseStatusSchema,
  /** Amendment chain (ISO/IEC 17025 §7.8.8). */
  isSuperseded: z.boolean(),
  isAmendment: z.boolean(),
});
export type PortalCertificateListItem = z.infer<
  typeof portalCertificateListItemSchema
>;

/** GET /api/portal/certificates */
export const portalCertificatesResponseSchema = z.object({
  data: z.array(portalCertificateListItemSchema),
  pagination: paginationSchema,
});
export type PortalCertificatesResponse = z.infer<
  typeof portalCertificatesResponseSchema
>;

const portalCertificateAmendmentSchema = z.object({
  isAmendment: z.boolean(),
  isSuperseded: z.boolean(),
  amendmentNumber: nullableNumber,
  amendmentReason: nullableString,
  supersededAt: nullableString,
  supersedes: z.object({ id: z.number(), jobId: z.string() }).nullable(),
  supersededBy: z
    .object({
      id: z.number(),
      jobId: z.string(),
      amendmentNumber: nullableNumber,
      approvedAt: nullableString,
    })
    .nullable(),
  chain: z.array(
    z.object({
      id: z.number(),
      jobId: z.string(),
      amendmentNumber: nullableNumber,
      approvedAt: nullableString,
      isCurrent: z.boolean(),
    }),
  ),
});

const portalReferenceStandardSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: nullableString.optional(),
  certificateNumber: z.string(),
  calibratedBy: nullableString.optional(),
  calibrationDate: z.string(),
  nextCalibrationDate: nullableString,
  certificateDocument: z
    .object({
      documentId: z.number(),
      fileName: z.string(),
      fileSize: z.number(),
      uploadedAt: z.string(),
      certificateNumber: z.string(),
      calibrationDate: z.string(),
      nextCalibrationDate: z.string(),
    })
    .nullable()
    .optional(),
});

/**
 * The slice of the frozen method snapshot the page renders: the method name
 * (`methodName`, not `name`) and the formulas that label the scalar results.
 */
const portalCertificateMethodSnapshotSchema = z
  .object({
    methodName: z.string().optional(),
    methodVersion: z.number().optional(),
    formulas: z
      .array(
        z.object({
          outputKey: z.string(),
          label: nullableString.optional(),
          unit: nullableString.optional(),
        }),
      )
      .nullable()
      .optional(),
  })
  .nullable();

/** GET /api/portal/certificates/:id */
export const portalCertificateDetailSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  status: z.string(),
  performedAt: nullableString,
  approvedAt: nullableString,
  dueDate: nullableString,
  certificateUrl: nullableString,
  releaseStatus: releaseStatusSchema,
  verificationToken: z.string(),
  verdict: z
    .object({
      conformity: z.enum(["CONFORMING", "NON_CONFORMING", "UNKNOWN"]),
      pointsTotal: z.number(),
      pointsWithin: z.number(),
      expandedUncertainty: nullableString,
    })
    .nullable(),
  methodSnapshot: portalCertificateMethodSnapshotSchema,
  results: jsonRecordSchema.nullable(),
  assetId: z.number(),
  assetPublicId: z.string(),
  assetName: z.string(),
  assetTag: z.string(),
  assetManufacturer: nullableString,
  assetModel: nullableString,
  assetSerialNumber: z.string(),
  serviceName: z.string(),
  labName: z.string(),
  labLogo: nullableString,
  labEmail: nullableString,
  labPhone: nullableString,
  accreditation: z.object({
    accredited: z.boolean(),
    number: nullableString,
  }),
  amendment: portalCertificateAmendmentSchema.nullable(),
  onSite: z.object({
    executedOnSite: z.boolean(),
    addressText: nullableString,
  }),
  referenceStandards: z.array(portalReferenceStandardSchema),
});
export type PortalCertificateDetail = z.infer<
  typeof portalCertificateDetailSchema
>;

/**
 * GET /certificates/:id/download, /certificates/:id/reference-standards/:sid/
 * certificate/download and /audit-packs/:id/download: a short-lived signed URL.
 */
export const portalDownloadLinkResponseSchema = z.object({
  url: z.string(),
  filename: z.string(),
});
export type PortalDownloadLinkResponse = z.infer<
  typeof portalDownloadLinkResponseSchema
>;

const auditPackStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

/** One audit pack of GET /api/portal/audit-packs. */
export const portalAuditPackSchema = z.object({
  id: z.number(),
  status: auditPackStatusSchema,
  dateFrom: z.string(),
  dateTo: z.string(),
  unitId: nullableNumber,
  unitName: nullableString,
  include: z.object({
    certificates: z.boolean(),
    fleetReport: z.boolean(),
    verificationIndex: z.boolean(),
  }),
  certificateCount: nullableNumber,
  fileSizeBytes: nullableNumber,
  expiresAt: nullableString,
  expired: z.boolean(),
  completedAt: nullableString,
  createdAt: z.string(),
});
export type PortalAuditPack = z.infer<typeof portalAuditPackSchema>;

/** GET /api/portal/audit-packs */
export const portalAuditPacksResponseSchema = z.object({
  data: z.array(portalAuditPackSchema),
});
export type PortalAuditPacksResponse = z.infer<
  typeof portalAuditPacksResponseSchema
>;

/** POST /api/portal/audit-packs (201): the queued export. */
export const portalAuditPackRequestedResponseSchema = z.object({
  id: z.number(),
  status: z.literal("PENDING"),
});
export type PortalAuditPackRequestedResponse = z.infer<
  typeof portalAuditPackRequestedResponseSchema
>;
