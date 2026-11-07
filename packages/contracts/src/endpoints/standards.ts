import { z } from "zod";
import {
  CreateReferenceStandardSchema,
  ImpactedCertificatesQuerySchema,
  ListReferenceStandardsQuerySchema,
  MassCompositionProfileCreateSchema,
  MassCompositionProfileUpdateSchema,
  ReferenceStandardKindSchema,
  ReferenceStandardStatusSchema,
  RenewCertificateSchema,
  SendStandardRecallSchema,
  UncertaintyDistributionSchema,
  UpdateReferenceStandardSchema,
} from "@calibra-facil/schemas";
import {
  OOT_NOTIFICATION_STATUSES,
  STANDARD_RECALL_STATUS,
} from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { certifiedValueSchema, metrologyDataSchema } from "../jobs";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's reference standards (`/api/standards/*`): the endpoint
 * definitions and their response contracts. Wire schemas (see `jobs.ts` for the rules): every
 * timestamp / calendar day is an ISO string, nothing here changes API output,
 * and the desktop local-server serves the very same shapes from its offline
 * mirror (`apps/local-server` contract tests parse them with these schemas).
 */

const standardStatusSchema = ReferenceStandardStatusSchema;

/** The original certificate PDF of a standard (current version). */
const standardCertificateDocumentSchema = z.object({
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
const standardCompositionProfileSchema = z.object({
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
const standardMetrologyDataSchema = metrologyDataSchema.extend({
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
const massCompositionProfileSchema = z.object({
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

// ---------------------------------------------------------------------------
// Audit log, recall and reverse traceability (#426)
// ---------------------------------------------------------------------------

const standardAuditEntrySchema = z.object({
  id: z.number(),
  standardId: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedBy: z.string(),
  performedByName: nullableString,
  performedAt: z.string(),
  ipAddress: nullableString,
  reason: nullableString,
});
export type StandardAuditLogEntry = z.infer<typeof standardAuditEntrySchema>;

/** An issued certificate that relied on the standard in the window. */
const impactedCertificateSchema = z.object({
  jobId: z.number(),
  certificateNumber: z.string(),
  status: z.string(),
  approvedAt: nullableString,
  performedAt: nullableString,
  customer: z.object({
    id: z.number(),
    name: z.string(),
    email: nullableString,
  }),
  supersededByJobId: nullableNumber,
  supersededByCertificateNumber: nullableString,
  alreadyNotified: z.boolean(),
});
export type ImpactedCertificate = z.infer<typeof impactedCertificateSchema>;

/** A job still on its way to a certificate that uses the recalled standard. */
const inFlightRecallJobSchema = z.object({
  jobId: z.number(),
  certificateNumber: z.string(),
  status: z.string(),
  performedAt: nullableString,
  customer: z.object({ id: z.number(), name: z.string() }),
});
export type InFlightRecallJob = z.infer<typeof inFlightRecallJobSchema>;

/** GET /api/standards/:id/impacted-certificates */
const impactedCertificatesResponseSchema = z.object({
  data: z.array(impactedCertificateSchema),
  inFlight: z.array(inFlightRecallJobSchema),
  window: z.object({ from: z.string(), to: z.string() }),
});
export type ImpactedCertificatesData = z.infer<
  typeof impactedCertificatesResponseSchema
>;

const standardRecallNotificationSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  certificateNumber: nullableString,
  recipientName: nullableString,
  recipientEmail: nullableString,
  status: z.enum(OOT_NOTIFICATION_STATUSES),
  sentAt: nullableString,
  acknowledgedAt: nullableString,
  acknowledgedVia: z.enum(["email_link", "portal_link", "manual"]).nullable(),
  bounced: z.boolean(),
});
export type StandardRecallNotification = z.infer<
  typeof standardRecallNotificationSchema
>;

const standardRecallSchema = z.object({
  id: z.number(),
  standardId: z.number(),
  ncId: z.number(),
  ncNumber: z.string(),
  status: z.enum(STANDARD_RECALL_STATUS.states),
  fromDate: nullableString,
  toDate: nullableString,
  approvedBy: nullableString,
  approvedAt: nullableString,
  createdAt: z.string(),
  notifications: z.array(standardRecallNotificationSchema),
  counts: z.object({
    total: z.number(),
    sent: z.number(),
    acknowledged: z.number(),
    bounced: z.number(),
    missingEmail: z.number(),
  }),
});
export type StandardRecall = z.infer<typeof standardRecallSchema>;

/** GET /api/standards/:id/recall: the latest campaign, or null when there is none. */
const standardRecallResponseSchema = z.object({
  data: standardRecallSchema.nullable(),
});
export type StandardRecallData = z.infer<typeof standardRecallResponseSchema>;

/** POST /api/standards/:id/recall/send */
const sendStandardRecallResponseSchema = z.object({
  message: z.string(),
  data: z.object({
    recallId: z.number(),
    created: z.number(),
    skipped: z.number(),
  }),
});
export type SendStandardRecallResult = z.infer<
  typeof sendStandardRecallResponseSchema
>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Padrões";
const RECALL_LABEL = "Recall de padrão";
const CERTIFICATE_LABEL = "Certificado de padrão";

/**
 * Not client-facing, so not defined here: `GET /search` (command palette) and
 * `GET /:id/label`.
 */
export const standardEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/standards",
    query: ListReferenceStandardsQuerySchema,
    response: standardsListResponseSchema,
    failure: "Falha ao carregar padrões",
    policy: "local-first-read-through-sync",
  }),
  get: endpoint({
    method: "get",
    path: "/api/standards/:id",
    response: standardSchema,
    failure: "Falha ao carregar padrão",
    policy: "local-first-read-through-sync",
  }),
  listCompositionProfiles: endpoint({
    method: "get",
    path: "/api/standards/composition-profiles",
    response: massCompositionProfilesResponseSchema,
    failure: "Falha ao carregar perfis de composição",
    policy: "local-first-read-through-sync",
  }),
  createCompositionProfile: endpoint({
    method: "post",
    path: "/api/standards/composition-profiles",
    body: MassCompositionProfileCreateSchema,
    response: massCompositionProfileSchema,
    status: 201,
    failure: "Erro ao criar perfil de composição",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateCompositionProfile: endpoint({
    method: "put",
    path: "/api/standards/composition-profiles/:id",
    body: MassCompositionProfileUpdateSchema,
    response: massCompositionProfileSchema,
    failure: "Erro ao atualizar perfil de composição",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  deleteCompositionProfile: endpoint({
    method: "delete",
    path: "/api/standards/composition-profiles/:id",
    response: z.object({ success: z.literal(true), id: z.number() }),
    failure: "Erro ao remover perfil de composição",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/standards/:id/audit-log",
    response: z.object({ data: z.array(standardAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/standards",
    body: CreateReferenceStandardSchema,
    response: standardRecordSchema,
    status: 201,
    failure: "Erro ao criar padrão",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  // The stored row: no validity verdict or certificate document.
  update: endpoint({
    method: "put",
    path: "/api/standards/:id",
    body: UpdateReferenceStandardSchema,
    response: standardRecordSchema,
    failure: "Erro ao atualizar padrão",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  // Soft delete: the standard is retired.
  delete: endpoint({
    method: "delete",
    path: "/api/standards/:id",
    response: z.object({ message: z.string(), data: standardRecordSchema }),
    failure: "Erro ao remover padrão",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  renew: endpoint({
    method: "post",
    path: "/api/standards/:id/renew",
    body: RenewCertificateSchema,
    response: z.object({ message: z.string(), data: standardRecordSchema }),
    failure: "Erro ao renovar certificado",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getImpactedCertificates: endpoint({
    method: "get",
    path: "/api/standards/:id/impacted-certificates",
    query: ImpactedCertificatesQuerySchema,
    response: impactedCertificatesResponseSchema,
    failure: "Falha ao carregar certificados afetados",
    policy: "cloud-only",
    desktopLabel: RECALL_LABEL,
  }),
  getRecall: endpoint({
    method: "get",
    path: "/api/standards/:id/recall",
    response: standardRecallResponseSchema,
    failure: "Falha ao carregar recall",
    policy: "cloud-only",
    desktopLabel: RECALL_LABEL,
  }),
  sendRecall: endpoint({
    method: "post",
    path: "/api/standards/:id/recall/send",
    body: SendStandardRecallSchema,
    response: sendStandardRecallResponseSchema,
    failure: "Erro ao enviar recall",
    policy: "cloud-only",
    desktopLabel: RECALL_LABEL,
  }),
  // The request is multipart/form-data (the `certificate` file), which a JSON
  // definition cannot describe: the route reads the form itself and the SDK
  // overrides the generated method (`client-runtime/src/modules/standards.ts`).
  uploadCertificateDocument: endpoint({
    method: "post",
    path: "/api/standards/:id/certificate-document",
    response: standardCertificateDocumentUploadResponseSchema,
    failure: "Erro ao enviar certificado do padrão",
    policy: "cloud-only",
    desktopLabel: CERTIFICATE_LABEL,
  }),
  getCertificateDocumentDownloadUrl: endpoint({
    method: "get",
    path: "/api/standards/:id/certificate-document/download",
    response: standardCertificateDocumentDownloadResponseSchema,
    failure: "Falha ao gerar link do certificado do padrão",
    policy: "cloud-only",
    desktopLabel: CERTIFICATE_LABEL,
  }),
} as const satisfies EndpointGroup;
