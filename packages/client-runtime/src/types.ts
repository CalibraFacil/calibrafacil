// Request payload types derived from @calibra-facil/schemas — the client
// can no longer drift from what the API validates (e.g. the hand-written
// CreateJobInput was missing sourceServiceOrderId). z.input (not z.infer)
// keeps fields with schema defaults optional for callers, matching what
// the wire actually accepts.
import type { z } from "zod";
import type {
  AdjustMaterialStockSchema,
  CreateAssetSchema,
  CreateCustomerSchema,
  CreateCustomerGroupSchema,
  CreateJobSchema,
  CreateMaterialSchema,
  CreateNonConformanceSchema,
  CreateServiceSchema,
  UpdateAssetSchema,
  UpdateCertificateNumberingProfileSchema,
  UpdateCustomerSchema,
  UpdateMaterialSchema,
  UpdateNotificationPreferencesSchema,
  UpdateServiceSchema,
} from "@calibra-facil/schemas";

export type AdjustMaterialStockInput = z.input<
  typeof AdjustMaterialStockSchema
>;
export type CreateAssetInput = z.input<typeof CreateAssetSchema>;
export type CreateCustomerInput = z.input<typeof CreateCustomerSchema>;
export type CreateCustomerGroupInput = z.input<
  typeof CreateCustomerGroupSchema
>;
export type CreateJobInput = z.input<typeof CreateJobSchema>;
export type CreateMaterialInput = z.input<typeof CreateMaterialSchema>;
export type CreateNonConformanceInput = z.input<
  typeof CreateNonConformanceSchema
>;
export type CreateServiceInput = z.input<typeof CreateServiceSchema>;
export type UpdateAssetInput = z.input<typeof UpdateAssetSchema>;
export type UpdateCertificateNumberingProfileInput = z.input<
  typeof UpdateCertificateNumberingProfileSchema
>;
export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;
export type UpdateMaterialInput = z.input<typeof UpdateMaterialSchema>;
export type UpdateNotificationPreferencesInput = z.input<
  typeof UpdateNotificationPreferencesSchema
>;
export type UpdateServiceInput = z.input<typeof UpdateServiceSchema>;

export type ServiceAuditLogData<TRecord = unknown> = {
  data: TRecord[];
};

export type AdjustMaterialStockData = {
  stockQuantity: number;
  stockSyncedAt: string | Date;
};

export type AssetAuditLogData<TRecord = unknown> = {
  data: TRecord[];
};

export type CustomerDetailData = CustomersListData["data"][number] & {
  address?: Record<string, unknown> | null;
  compliance?: {
    qualificationStatus?: "pending" | "qualified" | "suspended" | "expired";
    [key: string]: unknown;
  } | null;
  financialSummary?: {
    openDocumentsCount: number;
    overdueDocumentsCount: number;
    openBalanceCents: number;
    overdueBalanceCents: number;
    overdueBalanceFlag: boolean;
  };
  activeCommercialAgreement?: unknown;
  /** Parent customer group (rede), resolved on the detail payload. */
  group?: { id: number; name: string } | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

import type {
  LocalAttachment,
  LocalAttachmentsResponse,
  LocalSessionSnapshotResponse,
  LocalSyncConflict,
  LocalSyncConflictsResponse,
} from "@calibra-facil/contracts";
import type {
  JobsListData,
  JobsListStatus,
  JobExecutionPayload,
  EffectiveEnvironmentalLimitsResponse,
  LocalCertificateDraft,
  ReferenceStandardsResponse,
} from "./jobs";
import type {
  CreateServiceOrderInput,
  CreateServiceOrderQuoteInput,
  CreateServiceOrderResult,
  DeliverServiceOrderInput,
  IssueServiceOrderDeliveryDocumentInput,
  SaveServiceOrderExecutionInput,
  SaveServiceOrderEvaluationInput,
  SendServiceOrderQuoteInput,
  ServiceOrderCommunicationsData,
  ServiceOrderDetail,
  ServiceOrderDocumentUrl,
  ServiceOrderRepairMarkInput,
  ServiceOrdersListData,
  ServiceOrdersListInput,
  UpdateServiceOrderInput,
} from "./service-orders";
export type {
  JobsListData,
  JobsListStatus,
  JobExecutionPayload,
  EffectiveEnvironmentalLimitsResponse,
  LocalCertificateDraft,
  ReferenceStandardsResponse,
} from "./jobs";
export type {
  CreateServiceOrderInput,
  CreateServiceOrderQuoteInput,
  CreateServiceOrderResult,
  DeliverServiceOrderInput,
  IssueServiceOrderDeliveryDocumentInput,
  SaveServiceOrderExecutionInput,
  SaveServiceOrderEvaluationInput,
  SendServiceOrderQuoteInput,
  ServiceOrderCommunicationEntry,
  ServiceOrderCommunicationsData,
  ServiceOrderCommunicationStatus,
  ServiceOrderDetail,
  ServiceOrderDocumentUrl,
  ServiceOrderListItem,
  ServiceOrderRepairMarkInput,
  ServiceOrdersListData,
  ServiceOrdersListInput,
  ServiceOrderStatus,
  UpdateServiceOrderInput,
} from "./service-orders";
export type {
  LocalAttachment,
  LocalAttachmentsResponse,
  LocalSessionSnapshotResponse,
  LocalSyncConflict,
  LocalSyncConflictsResponse,
} from "@calibra-facil/contracts";

export type JobsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  query?: string;
  status?: JobsListStatus;
};

export type CreateJobResult = {
  id: number;
  jobId: string;
  status?: string;
};

export type TechnicianListData = {
  data: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
};

export type JobDownloadUrlData = {
  url: string;
};

export type JobAmendResult = {
  message: string;
  amendedJob: {
    id: number;
    jobId: string;
  };
};

export interface JobsApi {
  list(input: JobsListInput): Promise<JobsListData>;
  create(input: CreateJobInput): Promise<CreateJobResult>;
  get<TJob = unknown>(jobId: string | number): Promise<TJob>;
  listTechnicians(): Promise<TechnicianListData>;
  approve(
    jobId: string | number,
    input: {
      reason: string;
      environmentalJustification?: string;
      scopeOverrideJustification?: string;
    },
  ): Promise<unknown>;
  reject(jobId: string | number, reason: string): Promise<unknown>;
  cancel(jobId: string | number, reason: string): Promise<unknown>;
  assign(jobId: string | number, technicianId: string): Promise<unknown>;
  listStandards<TStandard = unknown>(): Promise<
    ReferenceStandardsResponse<TStandard>
  >;
  getEffectiveEnvironmentalLimits<TLimits = unknown>(
    assetTypeId: string | number,
    input?: { unitId?: string | number | null },
  ): Promise<EffectiveEnvironmentalLimitsResponse<TLimits>>;
  saveExecution(
    jobId: string | number,
    input: JobExecutionPayload,
  ): Promise<unknown>;
  submitExecution(
    jobId: string | number,
    input: JobExecutionPayload,
  ): Promise<unknown>;
  createCertificateDraft(
    jobId: string | number,
  ): Promise<LocalCertificateDraft>;
  getCertificateDownloadUrl(
    jobId: string | number,
  ): Promise<JobDownloadUrlData>;
  generateLabel(jobId: string | number): Promise<unknown>;
  getLabelDownloadUrl(jobId: string | number): Promise<JobDownloadUrlData>;
  /** Native printer commands (ZPL/TSPL) for direct thermal printing (text). */
  getLabelCommands(
    jobId: string | number,
    options?: { language?: "zpl" | "tspl"; dpi?: 203 | 300 },
  ): Promise<string>;
  amend(jobId: string | number, reason: string): Promise<JobAmendResult>;
  /**
   * §7.10 (#426): flags an approved job as out-of-tolerance (as found) —
   * opens a typed NC and, when notifyCustomer, generates the customer
   * notification (PDF + email via outbox).
   */
  flagOutOfTolerance(
    jobId: string | number,
    input: {
      description?: string;
      affectedScope?: string;
      notifyCustomer: boolean;
    },
  ): Promise<unknown>;
}

export interface SyncApi {
  getSession(): Promise<LocalSessionSnapshotResponse>;
  listConflicts(input?: {
    status?: "open" | "resolved" | "ignored";
    limit?: number;
  }): Promise<LocalSyncConflictsResponse>;
  resolveConflict(
    id: string,
    status?: "resolved" | "ignored",
  ): Promise<{ data: LocalSyncConflict }>;
}

export interface AttachmentsApi {
  list(input?: {
    entityType?: string;
    entityId?: string;
    limit?: number;
  }): Promise<LocalAttachmentsResponse>;
  upload(input: {
    entityType: string;
    entityId: string;
    file: Blob;
    fileName?: string;
  }): Promise<LocalAttachment>;
}

export type ServicesListInput = {
  page?: number;
  limit?: number;
  query?: string;
  assetTypeId?: number;
  methodId?: number;
  isActive?: boolean;
};

export type ServicesListData = {
  data: Array<{
    id: number;
    name: string;
    description: string | null;
    methodId: number | null;
    methodName: string | null;
    methodVersion: number | null;
    methodStatus: string | null;
    assetTypeId: number | null;
    assetTypeName: string | null;
    price: number | null;
    currency: string;
    tat: number | null;
    isActive: boolean;
    createdAt: string | Date | null;
    updatedAt: string | Date | null;
  }>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ServiceDetailData = ServicesListData["data"][number] & {
  methodVersion: number | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

export interface ServicesApi {
  list(input?: ServicesListInput): Promise<ServicesListData>;
  get(id: string | number): Promise<ServiceDetailData>;
  auditLog<TRecord = unknown>(
    id: string | number,
  ): Promise<ServiceAuditLogData<TRecord>>;
  create(input: CreateServiceInput): Promise<{ id: number }>;
  update(
    id: string | number,
    input: UpdateServiceInput,
  ): Promise<ServiceDetailData>;
  deactivate(id: string | number): Promise<unknown>;
}

export type MaterialsListInput = {
  page?: number;
  limit?: number;
  query?: string;
  controlsStock?: boolean;
  isActive?: boolean;
};

export type MaterialsListData = {
  data: Array<{
    id: number;
    name: string;
    description: string | null;
    sku: string | null;
    unit: string;
    unitCostCents: number | null;
    unitPriceCents: number | null;
    controlsStock: boolean;
    stockQuantity: number | null;
    stockSyncedAt: string | Date | null;
    isActive: boolean;
    createdAt: string | Date | null;
    updatedAt: string | Date | null;
  }>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type MaterialDetailData = MaterialsListData["data"][number];

export interface MaterialsApi {
  list(input?: MaterialsListInput): Promise<MaterialsListData>;
  get(id: string | number): Promise<MaterialDetailData>;
  create(input: CreateMaterialInput): Promise<{ id: number }>;
  update(
    id: string | number,
    input: UpdateMaterialInput,
  ): Promise<MaterialDetailData>;
  deactivate(id: string | number): Promise<unknown>;
  adjustStock(
    id: string | number,
    input: AdjustMaterialStockInput,
  ): Promise<AdjustMaterialStockData>;
}

export type MethodsListInput = {
  page?: number;
  limit?: number;
  status?: string;
  assetTypeId?: number;
  query?: string;
};

export type MethodsListData = {
  data: Array<{
    id: number;
    name: string;
    description: string | null;
    version: number;
    status: string;
    assetTypeId: number | null;
    assetTypeName: string | null;
    dataFields: unknown[];
    variableBindings?: unknown[];
    formulas: unknown[];
    measurementModels?: unknown[];
    validations: unknown[];
    uncertaintyParams?: unknown[];
    certificateContent?: unknown;
    accreditedScope?: boolean;
    compiledMethod?: unknown;
    methodFingerprint?: string | null;
    methodEngine?: { version?: string; optionsFingerprint?: string } | null;
    methodCompiledAt?: string | null;
    publicationEvidence?: unknown;
    createdAt: string;
    publishedAt: string | null;
    parentId: number | null;
  }>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type MethodDetailData = MethodsListData["data"][number] & {
  technicalReviewedBy?: string | null;
  approvedBy?: string | null;
  createdByName?: string;
  technicalReviewedByName?: string | null;
  approvedByName?: string | null;
  archivedAt?: string | null;
};

export type MethodWriteInput = {
  name?: string;
  description?: string | null;
  assetTypeId?: number | null;
  dataFields?: unknown[];
  variableBindings?: unknown[];
  formulas?: unknown[];
  measurementModels?: unknown[];
  validations?: unknown[];
  uncertaintyParams?: unknown[];
  certificateContent?: unknown;
  accreditedScope?: boolean;
  reason?: string;
};

export type MethodCompileDraftInput = {
  draft: unknown;
};

export type MethodPreviewDraftInput = {
  draft: unknown;
  sampleData: Record<string, unknown>;
};

export type MethodPublishDraftInput = {
  sampleData: Record<string, unknown>;
  reasonForChange?: string;
};

export type MethodRequestApprovalInput = {
  sampleData: Record<string, unknown>;
};

export type MethodAuditLogData<TRecord = unknown> = {
  data: TRecord[];
};

export type MethodGovernanceSource = {
  title: string;
  edition: string;
  section?: string;
  url?: string;
};

export type MethodGovernanceVerificarItem = {
  ref?: string;
  item: string;
  severity: "info" | "action" | "platform";
  fieldKeys?: string[];
};

export type MethodGovernance = {
  summary: string;
  measurand: string;
  model: "formulas" | "gum_measurement_model";
  sources: MethodGovernanceSource[];
  conformanceNotes: Array<{ ref: string; note: string }>;
  verificarItems: MethodGovernanceVerificarItem[];
  omittedComponents: Array<{
    ref: string;
    component: string;
    appliesWhen?: string;
  }>;
  workedExample?: {
    scenarioKey: string;
    provenance: "cited_guide_table" | "engine_characterization";
    source: string;
    expected: Record<string, number>;
  };
  reviewStatus: "draft_pending_revalidation";
};

/**
 * One entry of the curated method-template catalog (`GET /api/methods/templates`).
 * `governance` is the picker's informed-adoption surface; `spec` feeds the
 * read-only spec preview. Spec arrays are opaque here (the web layer narrows
 * them) to keep client-runtime free of server-side method types.
 */
export type MethodTemplateCatalogEntry = {
  templateKey: string;
  templateVersion: number;
  discipline: string;
  defaultName: string;
  defaultAccreditedScope: boolean;
  assetTypeSlug?: string;
  description: string;
  model: "formulas" | "gum_measurement_model";
  counts: {
    dataFields: number;
    formulas: number;
    validations: number;
    uncertaintyParams: number;
    verificar: number;
    omitted: number;
  };
  governance: MethodGovernance;
  spec: {
    dataFields: unknown[];
    formulas: unknown[];
    measurementModels: unknown[];
    validations: unknown[];
    uncertaintyParams: unknown[];
    certificateContent: unknown;
  };
  previewScenarios: unknown[];
};

/** Mandatory acknowledgements for adopting a template (all three must be true). */
export type MethodTemplateAcknowledgements = {
  readVerificarAndOmitted: true;
  acceptsVerificationDuty: true;
  understandsDraftGate: true;
  acknowledgedAt: string;
  templateVersion: number;
  acceptedVerificarRefs: string[];
};

export type MethodFromTemplateInput = {
  templateKey: string;
  assetTypeId?: number | null;
  name?: string;
  acknowledgements: MethodTemplateAcknowledgements;
};

export interface MethodsApi {
  list(input?: MethodsListInput): Promise<MethodsListData>;
  get(id: string | number): Promise<MethodDetailData>;
  audit<TRecord = unknown>(
    id: string | number,
  ): Promise<MethodAuditLogData<TRecord>>;
  create(input: MethodWriteInput): Promise<MethodDetailData>;
  update(
    id: string | number,
    input: MethodWriteInput,
  ): Promise<MethodDetailData>;
  archive(id: string | number): Promise<unknown>;
  createNewVersion(id: string | number): Promise<MethodDetailData>;
  technicalReview(id: string | number): Promise<unknown>;
  qualityApprove(
    id: string | number,
    input?: MethodWriteInput,
  ): Promise<unknown>;
  returnToDraft(id: string | number, reason: string): Promise<unknown>;
  compileDraft<TResponse = unknown>(
    input: MethodCompileDraftInput,
  ): Promise<TResponse>;
  previewDraft<TResponse = unknown>(
    input: MethodPreviewDraftInput,
  ): Promise<TResponse>;
  publishDraft<TResponse = unknown>(
    id: string | number,
    input: MethodPublishDraftInput,
  ): Promise<TResponse>;
  requestApproval<TResponse = unknown>(
    id: string | number,
    input: MethodRequestApprovalInput,
  ): Promise<TResponse>;
  /** Curated method-template catalog (cloud-only). */
  listMethodTemplates(): Promise<MethodTemplateCatalogEntry[]>;
  /** Adopt a template → creates a DRAFT method in the caller's org (cloud-only). */
  fromTemplate(input: MethodFromTemplateInput): Promise<MethodDetailData>;
}

export type StandardStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "OUT_OF_TOLERANCE"
  | "SENT_FOR_CALIBRATION";

export type CertifiedValue = {
  nominal: string;
  authentication?: string | null;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  compositionProfile?: boolean;
  profileKey?: string | null;
  profileClass?: string | null;
  profileQuantityAvailable?: number | null;
};

export type ReferenceStandardKind =
  | "mass_single"
  | "mass_set"
  | "thermohygrometer"
  | "thermometer"
  | "hygrometer"
  | "barometer"
  | "manometer"
  | "dimensional"
  | "electrical"
  | "time_frequency"
  | "volume"
  | "force_torque"
  | "rpm"
  | "generic_scalar"
  | "generic_multi_channel";

export type ReferenceStandardMetrologyPoint = {
  reference?: number | null;
  indication?: number | null;
  meanReading?: number | null;
  correction?: number | null;
  uncertainty?: number | null;
  unit: string;
  coverageFactor?: number | null;
  degreesOfFreedom?: number | null;
  degreesOfFreedomOperator?: "exact" | "greater_than" | "infinity";
  repeatability?: number | null;
  metadata?: Record<string, unknown>;
};

export type ReferenceStandardMetrologyChannel = {
  key: string;
  label: string;
  quantity: string;
  value?: number | null;
  correction?: number | null;
  uncertainty?: number | null;
  unit: string;
  coverageFactor?: number | null;
  drift?: number | null;
  notes?: string | null;
  points?: ReferenceStandardMetrologyPoint[];
};

export type ReferenceStandardMassValue = {
  nominal: string;
  authentication?: string | null;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
};

export type ReferenceStandardCompositionProfile = {
  profileKey: string;
  profileClass?: string | null;
  nominal: string;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  quantityAvailable?: number | null;
};

export type ReferenceStandardMetrologyData = {
  version: 1;
  channels: ReferenceStandardMetrologyChannel[];
  massValues: ReferenceStandardMassValue[];
  compositionProfiles: ReferenceStandardCompositionProfile[];
  notes?: string | null;
};

export type ReferenceStandardCertificateDocument = {
  documentId: number;
  r2Key: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedAt: string | Date;
  certificateNumber: string;
  calibrationDate: string | Date;
  nextCalibrationDate: string | Date;
};

export type StandardData = {
  id: number;
  name: string;
  kind: ReferenceStandardKind;
  type: string | null;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  certificateNumber: string;
  calibratedBy: string | null;
  calibrationDate: string;
  nextCalibrationDate: string;
  referenceValue: number | null;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  distribution: "normal" | "rectangular";
  drift: number | null;
  certifiedValues: CertifiedValue[] | null;
  metrologyData: ReferenceStandardMetrologyData | null;
  certificateDocument?: ReferenceStandardCertificateDocument | null;
  status: StandardStatus;
  isExpired: boolean;
  daysUntilExpiry: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type StandardsListInput = {
  page?: number;
  limit?: number;
  query?: string;
  status?: StandardStatus;
};

export type StandardsListData = {
  data: StandardData[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type StandardWriteInput = Record<string, unknown>;

export type StandardAuditLogData<TRecord = unknown> = {
  data: TRecord[];
};

export type StandardCertificateDocumentUploadResponse = {
  message: string;
  document: ReferenceStandardCertificateDocument;
};

export type StandardCertificateDocumentDownloadResponse = {
  url: string;
  filename: string;
};

/** A row of the normalized mass composition-profile catalog (per organization). */
export type MassCompositionProfileDto = {
  id: number;
  profileKey: string;
  profileClass: string;
  nominal: string;
  nominalG: number;
  value: number;
  uncertainty: number;
  unit: string;
  maxError: number | null;
  drift: number | null;
  buoyancy: number | null;
  coverageFactor: number | null;
  quantityAvailable: number | null;
};

export type MassCompositionProfilesData = {
  data: MassCompositionProfileDto[];
};

export type MassCompositionProfileWriteInput = {
  profileKey: string;
  profileClass: string;
  nominal: string;
  nominalG: number;
  value: number;
  uncertainty: number;
  unit?: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  quantityAvailable?: number | null;
};

export interface StandardsApi {
  list(input?: StandardsListInput): Promise<StandardsListData>;
  get(id: string | number): Promise<StandardData>;
  listCompositionProfiles(): Promise<MassCompositionProfilesData>;
  createCompositionProfile(
    input: MassCompositionProfileWriteInput,
  ): Promise<MassCompositionProfileDto>;
  updateCompositionProfile(
    id: number,
    input: Partial<MassCompositionProfileWriteInput>,
  ): Promise<MassCompositionProfileDto>;
  deleteCompositionProfile(
    id: number,
  ): Promise<{ success: boolean; id: number }>;
  auditLog<TRecord = unknown>(
    id: string | number,
  ): Promise<StandardAuditLogData<TRecord>>;
  create(input: StandardWriteInput): Promise<{ id: number }>;
  update(id: string | number, input: StandardWriteInput): Promise<StandardData>;
  delete(id: string | number): Promise<unknown>;
  renew(id: string | number, input: StandardWriteInput): Promise<unknown>;
  /** #426 Phase 1: certificates issued using this standard, date-bounded. */
  getImpactedCertificates<TResponse = unknown>(
    id: string | number,
    input?: { from?: string; to?: string },
  ): Promise<TResponse>;
  /** #426 Phase 1: latest recall campaign + per-certificate ack status. */
  getRecall<TResponse = unknown>(id: string | number): Promise<TResponse>;
  /** #426 Phase 1: approval-gated batch send of the recall notifications. */
  sendRecall<TResponse = unknown>(
    id: string | number,
    input: { jobIds: number[]; from?: string; to?: string },
  ): Promise<TResponse>;
  uploadCertificateDocument(
    id: string | number,
    file: Blob,
    input?: { fileName?: string },
  ): Promise<StandardCertificateDocumentUploadResponse>;
  getCertificateDocumentDownloadUrl(
    id: string | number,
  ): Promise<StandardCertificateDocumentDownloadResponse>;
}

export type CustomersListInput = {
  page: number;
  limit: number;
  query?: string;
};

export type CustomersListData = {
  data: Array<{
    id: number;
    name: string;
    tradeName?: string | null;
    taxId: string | null;
    email: string | null;
    phone?: string | null;
    authOrganizationId: string | null;
    groupId?: number | null;
    groupName?: string | null;
    compliance?: {
      qualificationStatus?: "pending" | "qualified" | "suspended" | "expired";
    } | null;
  }>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type UpdateCustomerComplianceInput = {
  compliance: Record<string, unknown>;
  reason: string;
};

export type CustomerAuditLogData<TRecord = unknown> = {
  data: TRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

/** Receita Federal registry data resolved from a CNPJ, used to pre-fill the cadastro. */
export type CnpjLookupResult = {
  taxId: string;
  name: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  address: {
    cep: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    neighbourhood: string | null;
    city: string | null;
    state: string | null;
  };
};

export interface CustomersApi {
  list(input: CustomersListInput): Promise<CustomersListData>;
  /** Resolve a CNPJ against the Receita Federal mirrors. Returns null when not found. */
  lookupCnpj(cnpj: string): Promise<CnpjLookupResult | null>;
  create(
    input: CreateCustomerInput,
  ): Promise<CustomersListData["data"][number]>;
  get<TCustomer = CustomerDetailData>(id: string | number): Promise<TCustomer>;
  update<TCustomer = CustomerDetailData>(
    id: string | number,
    input: UpdateCustomerInput,
  ): Promise<TCustomer>;
  auditLog<TRecord = unknown>(
    id: string | number,
    input?: { page?: number; limit?: number },
  ): Promise<CustomerAuditLogData<TRecord>>;
  ootEvents<TResponse = unknown>(id: string | number): Promise<TResponse>;
  updateCompliance<TCustomer = CustomerDetailData>(
    id: string | number,
    input: UpdateCustomerComplianceInput,
  ): Promise<TCustomer>;
  listMembers<TMember = unknown>(id: string | number): Promise<TMember[]>;
  listInvitations<TInvitation = unknown>(
    id: string | number,
  ): Promise<TInvitation[]>;
  createInvitation<TInvitation = unknown>(
    id: string | number,
    input: { email: string; role: string },
  ): Promise<TInvitation>;
  resendInvitation(id: string | number, invitationId: string): Promise<unknown>;
  cancelInvitation(id: string | number, invitationId: string): Promise<unknown>;
  removeMember(id: string | number, memberId: string): Promise<unknown>;
}

// =============================================================================
// CUSTOMER GROUPS (multi-unit client networks)
// =============================================================================

export type CustomerGroupListItem = {
  id: number;
  name: string;
  authOrganizationId: string;
  createdAt: string | Date;
  branchCount: number;
};

export type CustomerGroupsListData = { data: Array<CustomerGroupListItem> };

export type CustomerGroupBranch = {
  id: number;
  name: string;
  taxId: string | null;
  /** Active-instrument counts for the branch (overview KPIs). */
  total: number;
  overdue: number;
  dueSoon: number;
};

export type CustomerGroupDetailData = {
  id: number;
  name: string;
  authOrganizationId: string;
  createdAt: string | Date;
  branches: Array<CustomerGroupBranch>;
};

export interface CustomerGroupsApi {
  list(): Promise<CustomerGroupsListData>;
  get(id: string | number): Promise<CustomerGroupDetailData>;
  create(
    input: CreateCustomerGroupInput,
  ): Promise<CustomerGroupDetailData & { invitationId: string | null }>;
  addBranch(
    groupId: string | number,
    customerId: number,
  ): Promise<{ success: boolean }>;
  removeBranch(
    groupId: string | number,
    customerId: string | number,
  ): Promise<{ success: boolean }>;
  listMembers<TMember = unknown>(id: string | number): Promise<TMember[]>;
  listInvitations<TInvitation = unknown>(
    id: string | number,
  ): Promise<TInvitation[]>;
  createInvitation<TInvitation = unknown>(
    id: string | number,
    input: { email: string; role: string },
  ): Promise<TInvitation>;
  resendInvitation(id: string | number, invitationId: string): Promise<unknown>;
  cancelInvitation(id: string | number, invitationId: string): Promise<unknown>;
  removeMember(id: string | number, memberId: string): Promise<unknown>;
}

export type AssetsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  status?: string;
  query?: string;
};

export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

/**
 * Every measurement unit token accepted as an asset's base unit. Mirrors
 * `MeasurementUnitSchema` in `@calibra-facil/schemas` / the kind-aware registry
 * in `@calibra-facil/shared/units`; kept as a local literal union so the SDK
 * contract has no runtime/server dependency. Keep in sync with that enum.
 */
export type MeasurementUnit =
  | "mg"
  | "g"
  | "kg"
  | "µm"
  | "mm"
  | "cm"
  | "m"
  | "°C"
  | "°F"
  | "K"
  | "Pa"
  | "kPa"
  | "MPa"
  | "bar"
  | "psi"
  | "kgf/cm²"
  | "mmHg"
  | "inHg"
  | "µL"
  | "mL"
  | "L"
  | "m³"
  | "ms"
  | "s"
  | "min"
  | "h"
  | "N·m"
  | "kgf·m"
  | "%RH"
  // force
  | "N"
  | "kN"
  | "kgf"
  // voltage
  | "µV"
  | "mV"
  | "V"
  | "kV"
  // current
  | "µA"
  | "mA"
  | "A"
  // resistance
  | "Ω"
  | "kΩ"
  | "MΩ"
  // frequency
  | "Hz"
  | "kHz"
  | "MHz"
  | "rpm";

export type AssetsListData = {
  data: Array<{
    id: number;
    customerId: number;
    customerName: string;
    customerTaxId?: string | null;
    name: string;
    tag: string;
    serialNumber: string;
    manufacturer: string | null;
    model: string | null;
    assetTypeId?: number;
    assetTypeName: string;
    status: AssetStatus;
    nextCalibrationDate?: string | null;
    // Legal-metrology regime (Track 2). The service-order repair-mark / lacre gating
    // renders for `metrologyRegime === 'LEGAL'`.
    metrologyRegime?: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
  }>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type AssetDetailData = AssetsListData["data"][number] & {
  assetTypeSlug?: string | null;
  assetTypeDefinition?: unknown;
  baseMeasurementUnit?: "mg" | "g" | "kg" | string | null;
  lastCalibrationDate?: string | Date | null;
  nextCalibrationDate?: string | Date | null;
  installedAt?: string | Date | null;
  comments?: string | null;
  specifications?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  // Legal-metrology regime (Track 2) + the regulation-fixed verification periodicity,
  // independent of the customer-owned calibration interval. See specs/legal-metrology-regime.
  metrologyRegime?: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
  regulatedInterval?: {
    kind:
      | "fixed_months"
      | "max_months_from_install"
      | "per_technology"
      | "not_nationally_fixed";
    valueMonths?: number;
    anchor?: string;
    technology?: string;
    regulationReference: string;
    operationalizedByDelegate: boolean;
    note?: string;
  } | null;
  nextLegalVerificationDate?: string | Date | null;
};

export interface AssetsApi {
  list(input: AssetsListInput): Promise<AssetsListData>;
  create(input: CreateAssetInput): Promise<AssetsListData["data"][number]>;
  get<TAsset = AssetDetailData>(id: string | number): Promise<TAsset>;
  update<TAsset = AssetDetailData>(
    id: string | number,
    input: UpdateAssetInput,
  ): Promise<TAsset>;
  auditLog<TRecord = unknown>(
    id: string | number,
  ): Promise<AssetAuditLogData<TRecord>>;
}

export type AssetTypeListItem = {
  id: number;
  name: string;
  slug?: string | null;
  description: string | null;
  definition: unknown;
};

export type AssetTypesListData = {
  data: AssetTypeListItem[];
};

export interface AssetTypesApi {
  list(): Promise<AssetTypesListData>;
}

export type EnvironmentalLimit = {
  id: number;
  unitId: number;
  assetTypeId: number | null;
  assetTypeName: string | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  pressureMin: number | null;
  pressureMax: number | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type EnvironmentalLimitsResponse = {
  limits: EnvironmentalLimit[];
  unit: { unitId: number | null; unitName: string | null };
};

export type SaveEnvironmentalLimitInput = {
  assetTypeId: number | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  pressureMin: number | null;
  pressureMax: number | null;
};

export type SaveEnvironmentalLimitResponse = {
  message: string;
  data: EnvironmentalLimit;
  unit: { unitId: number | null; unitName: string | null };
};

export interface EnvironmentalLimitsApi {
  list(): Promise<EnvironmentalLimitsResponse>;
  save(
    input: SaveEnvironmentalLimitInput,
  ): Promise<SaveEnvironmentalLimitResponse>;
  delete(id: number): Promise<{ message: string }>;
}

/** Accredited-scope (CMC) line — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14 (#427). */
export type AccreditedScopeLine = {
  id: number;
  unitId: number;
  quantityKind: string;
  rangeMin: number;
  rangeMax: number;
  rangeUnit: string;
  cmcType: "fixed" | "linear";
  cmcA: number;
  cmcB: number | null;
  cmcUnit: string;
  coverageFactor: number;
  description: string | null;
  validFrom: string | Date | null;
  validUntil: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type ScopeEnforcementMode = "warn" | "enforce";

export type AccreditedScopeResponse = {
  lines: AccreditedScopeLine[];
  unit: { unitId: number | null; unitName: string | null };
  /** Org-level guard behavior (#427 Phase 1). */
  enforcementMode: ScopeEnforcementMode;
};

export type SaveAccreditedScopeLineInput = {
  id?: number;
  quantityKind: string;
  rangeMin: number;
  rangeMax: number;
  rangeUnit: string;
  cmcType: "fixed" | "linear";
  cmcA: number;
  cmcB?: number | null;
  cmcUnit: string;
  coverageFactor?: number;
  description?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
};

export type SaveAccreditedScopeLineResponse = {
  message: string;
  data: AccreditedScopeLine;
  unit: { unitId: number | null; unitName: string | null };
};

export interface AccreditedScopeApi {
  list(): Promise<AccreditedScopeResponse>;
  save(
    input: SaveAccreditedScopeLineInput,
  ): Promise<SaveAccreditedScopeLineResponse>;
  delete(id: number): Promise<{ message: string }>;
  setEnforcementMode(mode: ScopeEnforcementMode): Promise<{
    message: string;
    enforcementMode: ScopeEnforcementMode;
  }>;
}

export type ReportsQueryInput = {
  period?: string;
  unitIds?: string;
};

export interface ReportsApi {
  getExecutiveOverview<TResponse = unknown>(
    input?: ReportsQueryInput,
  ): Promise<TResponse>;
  getComparison<TResponse = unknown>(
    input?: ReportsQueryInput,
  ): Promise<TResponse>;
  getTrend<TResponse = unknown>(input?: ReportsQueryInput): Promise<TResponse>;
}

export interface PublicCheckoutApi {
  getSnapshot<TResponse = unknown>(token: string): Promise<TResponse>;
  getStatus<TResponse = unknown>(token: string): Promise<TResponse>;
  start<TResponse = unknown>(token: string): Promise<TResponse>;
}

export interface PublicLeadsApi {
  create<TResponse = unknown, TInput = unknown>(
    input: TInput,
  ): Promise<TResponse>;
}

export type NonConformanceListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: string;
  type?: string;
  jobId?: string | number;
  dateFrom?: string;
  dateTo?: string;
};

export type CreateNonConformanceResult = {
  id: number;
  ncNumber: string;
};

export type NonConformanceDispositionInput = {
  disposition: "rework" | "scrap" | "use_as_is" | "concession";
  justification?: string;
};

export type NonConformanceResolveInput = {
  correctionTaken: string;
};

export type NonConformanceEscalateInput = {
  rootCauseAnalysis?: string;
  actionPlan?: string;
  responsibleId?: string;
  dueDate?: string;
};

export type RegisterOotAcknowledgementInput = {
  note: string;
};

/** #426 Phase 2: guided §7.10 impact-assessment payload. */
export type SaveOotImpactAssessmentInput = {
  deviationSummary: string;
  deviationMagnitude?: number;
  customerTolerance?: number;
  toleranceUnit?: string;
  affectedFrom?: string;
  affectedTo?: string;
  items: Array<{
    description: string;
    disposition: "no_impact" | "recheck" | "notify_downstream" | "other";
    note?: string;
  }>;
  conclusion?: "no_significant_impact" | "impact_confirmed" | "inconclusive";
  correctiveActionNote?: string;
};

export type OotImpactAssessmentData = {
  id: number;
  ncId: number;
  deviationSummary: string;
  deviationMagnitude: number | null;
  customerTolerance: number | null;
  toleranceUnit: string | null;
  affectedFrom: string | null;
  affectedTo: string | null;
  items: Array<{
    description: string;
    disposition: "no_impact" | "recheck" | "notify_downstream" | "other";
    note?: string | null;
  }> | null;
  conclusion:
    | "no_significant_impact"
    | "impact_confirmed"
    | "inconclusive"
    | null;
  correctiveActionNote: string | null;
  signedBy: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** §7.10 out-of-tolerance customer-notification record (#426 Phase 0). */
export type OotNotificationData = {
  id: number;
  ncId: number;
  jobId: number;
  certificateNumber: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  affectedScope: string | null;
  status: "PENDING" | "GENERATED" | "SENT" | "ACKNOWLEDGED";
  pdfR2Key: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedVia: "email_link" | "portal_link" | "manual" | null;
  acknowledgedNote: string | null;
  createdAt: string;
};

export interface NonConformancesApi {
  list<TResponse = unknown>(input: NonConformanceListInput): Promise<TResponse>;
  summary<TResponse = unknown>(): Promise<TResponse>;
  get<TResponse = unknown>(id: string | number): Promise<TResponse>;
  auditLog<TResponse = unknown>(id: string | number): Promise<TResponse>;
  create(input: CreateNonConformanceInput): Promise<CreateNonConformanceResult>;
  setDisposition<TResponse = unknown>(
    id: string | number,
    input: NonConformanceDispositionInput,
  ): Promise<TResponse>;
  resolve<TResponse = unknown>(
    id: string | number,
    input: NonConformanceResolveInput,
  ): Promise<TResponse>;
  escalateToCapa<TResponse = unknown>(
    id: string | number,
    input: NonConformanceEscalateInput,
  ): Promise<TResponse>;
  getOotNotification<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  registerOotAcknowledgement<TResponse = unknown>(
    id: string | number,
    input: RegisterOotAcknowledgementInput,
  ): Promise<TResponse>;
  getImpactAssessment<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  saveImpactAssessment<TResponse = unknown>(
    id: string | number,
    input: SaveOotImpactAssessmentInput,
  ): Promise<TResponse>;
  signImpactAssessment<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
}

export type CapaListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: string;
  severity?: string;
  category?: string;
  source?: string;
  type?: string;
  responsibleId?: string;
  overdue?: boolean;
};

export type CapaCreateInput = {
  title: string;
  description: string;
  source:
    | "internal_audit"
    | "customer_complaint"
    | "nc_detection"
    | "external_audit"
    | "management_review";
  sourceReference?: string;
  detectionDate: string;
  type: "corrective" | "preventive";
  severity: "minor" | "major" | "critical";
  category:
    | "method"
    | "equipment"
    | "personnel"
    | "procedure"
    | "environment"
    | "other";
  actionPlan: string;
  responsibleId: string;
  dueDate: string;
  rootCauseAnalysis?: string;
  rootCauseAnalysisMethod?: "5_whys" | "fishbone" | "pareto" | "other";
  preventiveMeasures?: string;
};

export type CapaUpdateInput = Partial<CapaCreateInput>;

export type CapaImplementInput = {
  implementationEvidence: string;
};

export type CapaVerifyInput = {
  effectivenessConfirmed: boolean;
  verificationNotes?: string;
};

export type CapaCloseInput = {
  reason?: string;
};

export interface CapasApi {
  list<TResponse = unknown>(input: CapaListInput): Promise<TResponse>;
  summary<TResponse = unknown>(): Promise<TResponse>;
  get<TResponse = unknown>(id: string | number): Promise<TResponse>;
  auditLog<TResponse = unknown>(id: string | number): Promise<TResponse>;
  create<TResponse = unknown>(input: CapaCreateInput): Promise<TResponse>;
  update<TResponse = unknown>(
    id: string | number,
    input: CapaUpdateInput,
  ): Promise<TResponse>;
  implement<TResponse = unknown>(
    id: string | number,
    input: CapaImplementInput,
  ): Promise<TResponse>;
  verify<TResponse = unknown>(
    id: string | number,
    input: CapaVerifyInput,
  ): Promise<TResponse>;
  close<TResponse = unknown>(
    id: string | number,
    input: CapaCloseInput,
  ): Promise<TResponse>;
}

export type ProficiencyTestListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: string;
  activityType?: string;
  scopePart?: string;
};

export type ProficiencyTestCreateInput = {
  activityType?: "proficiency_test" | "interlab_comparison";
  provider: string;
  providerAccreditation?: string;
  ptRound: string;
  scopePart: string;
  metrologyKind?: string;
  standardId?: number;
  unitId?: number;
  registrationDate?: string;
  participationDate?: string;
  notes?: string;
};

export type ProficiencyTestUpdateInput = Partial<ProficiencyTestCreateInput>;

export type PtResultPointInput = {
  label: string;
  unit?: string;
  labValue: number;
  labUncertainty?: number;
  refValue: number;
  refUncertainty?: number;
  sigmaPt?: number;
  scoreType?: "en" | "z" | "z_prime" | "zeta";
};

export type ProficiencyTestRecordResultsInput = {
  resultReportedAt: string;
  results: PtResultPointInput[];
};

export type PtPlanItemCreateInput = {
  scopePart: string;
  riskJustification?: string;
  frequencyMonths?: number;
  unitId?: number;
  lastSatisfactoryAt?: string;
};

export type PtPlanItemUpdateInput = Partial<PtPlanItemCreateInput>;

export interface ProficiencyTestsApi {
  list<TResponse = unknown>(
    input: ProficiencyTestListInput,
  ): Promise<TResponse>;
  summary<TResponse = unknown>(): Promise<TResponse>;
  get<TResponse = unknown>(id: string | number): Promise<TResponse>;
  auditLog<TResponse = unknown>(id: string | number): Promise<TResponse>;
  create<TResponse = unknown>(
    input: ProficiencyTestCreateInput,
  ): Promise<TResponse>;
  update<TResponse = unknown>(
    id: string | number,
    input: ProficiencyTestUpdateInput,
  ): Promise<TResponse>;
  recordResults<TResponse = unknown>(
    id: string | number,
    input: ProficiencyTestRecordResultsInput,
  ): Promise<TResponse>;
  remove<TResponse = unknown>(id: string | number): Promise<TResponse>;
  listPlan<TResponse = unknown>(): Promise<TResponse>;
  createPlanItem<TResponse = unknown>(
    input: PtPlanItemCreateInput,
  ): Promise<TResponse>;
  updatePlanItem<TResponse = unknown>(
    id: string | number,
    input: PtPlanItemUpdateInput,
  ): Promise<TResponse>;
  removePlanItem<TResponse = unknown>(id: string | number): Promise<TResponse>;
}

export type SpcChartListInput = {
  standardId?: number;
  status?: string;
  page?: number;
  limit?: number;
};

export type SpcChartParamsInput = {
  baselineWindow?: number;
  centerline?: number;
  sigma?: number;
  subgroupSize?: number;
  cusumK?: number;
  cusumH?: number;
  ewmaLambda?: number;
  ewmaK?: number;
  enabledRules?: string[];
};

export type SpcChartCreateInput = {
  standardId: number;
  parameter: string;
  chartType?: "i_mr" | "xbar_r" | "cusum" | "ewma";
  params?: SpcChartParamsInput;
  unitId?: number;
};

export type SpcChartUpdateInput = {
  chartType?: "i_mr" | "xbar_r" | "cusum" | "ewma";
  params?: SpcChartParamsInput;
};

export type SpcEscalateInput = {
  description?: string;
};

export type SpcReadingListInput = {
  standardId: number;
  parameter?: string;
  limit?: number;
};

export type SpcReadingCreateInput = {
  standardId: number;
  parameter: string;
  value: number;
  uncertainty?: number;
  measuredAt: string;
  sourceJobId?: number;
};

export interface SpcApi {
  listCharts<TResponse = unknown>(
    input?: SpcChartListInput,
  ): Promise<TResponse>;
  getChart<TResponse = unknown>(id: string | number): Promise<TResponse>;
  createChart<TResponse = unknown>(
    input: SpcChartCreateInput,
  ): Promise<TResponse>;
  updateChart<TResponse = unknown>(
    id: string | number,
    input: SpcChartUpdateInput,
  ): Promise<TResponse>;
  removeChart<TResponse = unknown>(id: string | number): Promise<TResponse>;
  recalculateChart<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  escalateChart<TResponse = unknown>(
    id: string | number,
    input?: SpcEscalateInput,
  ): Promise<TResponse>;
  listReadings<TResponse = unknown>(
    input: SpcReadingListInput,
  ): Promise<TResponse>;
  createReading<TResponse = unknown>(
    input: SpcReadingCreateInput,
  ): Promise<TResponse>;
  removeReading<TResponse = unknown>(id: string | number): Promise<TResponse>;
}

export type CertificateTemplateCreateInput = {
  name: string;
  /** Template engine; "wysiwyg" bootstraps a v1 DRAFT starter version. */
  engine?: "xlsx" | "wysiwyg";
};

export type CertificateTemplateUpdateInput = {
  name?: string;
};

export type CertificateTemplateXlsxAssignmentInput = {
  certificateType: "calibration";
  priority: number;
  unitId?: number;
  serviceId?: number;
  methodId?: number;
};

export interface CertificateTemplatesApi {
  list<TResponse = unknown>(): Promise<TResponse>;
  create<TResponse = unknown>(
    input: CertificateTemplateCreateInput,
  ): Promise<TResponse>;
  update<TResponse = unknown>(
    id: string | number,
    input: CertificateTemplateUpdateInput,
  ): Promise<TResponse>;
  duplicate<TResponse = unknown>(id: string | number): Promise<TResponse>;
  archive<TResponse = unknown>(id: string | number): Promise<TResponse>;
  listAssignments<TResponse = unknown>(id: string | number): Promise<TResponse>;
  archiveAssignment<TResponse = unknown>(
    id: string | number,
    assignmentId: string | number,
  ): Promise<TResponse>;
  setDefault<TResponse = unknown>(id: string | number): Promise<TResponse>;
  getXlsxVersion<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
  ): Promise<TResponse>;
  uploadXlsx<TResponse = unknown>(
    templateId: string | number,
    file: Blob,
    input?: { fileName?: string },
  ): Promise<TResponse>;
  validateXlsx<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
  ): Promise<TResponse>;
  updateXlsxBindings<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
    input: { manifest: unknown },
  ): Promise<TResponse>;
  createXlsxPreview<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
    input: { sampleData: unknown },
  ): Promise<TResponse>;
  getXlsxPreview<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
    previewId: string | number,
  ): Promise<TResponse>;
  publishXlsx<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
  ): Promise<TResponse>;
  createXlsxAssignment<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
    input: CertificateTemplateXlsxAssignmentInput,
  ): Promise<TResponse>;
  // ---- wysiwyg engine (epic wysiwyg) ----
  getWysiwygDocument<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
  ): Promise<TResponse>;
  getPlaceholderCatalog<TResponse = unknown>(): Promise<TResponse>;
  saveWysiwygDocument<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
    input: {
      documentJson: Record<string, unknown>;
      expectedDocumentSha256?: string;
    },
  ): Promise<TResponse>;
  validateWysiwygDocument<TResponse = unknown>(
    templateId: string | number,
    versionId: string | number,
  ): Promise<TResponse>;
  createWysiwygVersion<TResponse = unknown>(
    templateId: string | number,
  ): Promise<TResponse>;
  migrateToWysiwyg<TResponse = unknown>(
    templateId: string | number,
  ): Promise<TResponse>;
}

export type CompetenceListInput = {
  page: number;
  limit: number;
  status?: string;
  userId?: string;
  assetTypeId?: string | number;
};

export type CompetenceCreateInput = {
  userId: string;
  assetTypeId?: number;
  scopeDescription: string;
};

export type CompetenceEvaluateInput = {
  passed: boolean;
  notes?: string;
  qualifiedAt?: string;
  expiresAt?: string;
};

export type CompetenceAssignTrainingInput = {
  trainingRecordIds: number[];
};

export interface CompetencesApi {
  list<TResponse = unknown>(input: CompetenceListInput): Promise<TResponse>;
  matrix<TResponse = unknown>(): Promise<TResponse>;
  get<TResponse = unknown>(id: string | number): Promise<TResponse>;
  auditLog<TResponse = unknown>(id: string | number): Promise<TResponse>;
  create<TResponse = unknown>(input: CompetenceCreateInput): Promise<TResponse>;
  transition<TResponse = unknown>(
    id: string | number,
    action: "start-training" | "complete-training" | "suspend",
  ): Promise<TResponse>;
  evaluate<TResponse = unknown>(
    id: string | number,
    input: CompetenceEvaluateInput,
  ): Promise<TResponse>;
  renew<TResponse = unknown>(
    id: string | number,
    input: CompetenceEvaluateInput,
  ): Promise<TResponse>;
  cancel<TResponse = unknown>(
    id: string | number,
    input?: { notes?: string },
  ): Promise<TResponse>;
  delete<TResponse = unknown>(id: string | number): Promise<TResponse>;
  assignTraining<TResponse = unknown>(
    id: string | number,
    input: CompetenceAssignTrainingInput,
  ): Promise<TResponse>;
}

export type TrainingRecordsListInput = {
  page: number;
  limit: number;
  userId?: string;
  competenceId?: string | number;
  status?: string;
  type?: string;
};

export type TrainingRecordCreateInput = {
  userId: string;
  title: string;
  type: string;
  provider?: string;
  description?: string;
  startDate: string;
  endDate?: string;
  competenceId?: number;
};

export interface TrainingRecordsApi {
  list<TResponse = unknown>(
    input: TrainingRecordsListInput,
  ): Promise<TResponse>;
  create<TResponse = unknown>(
    input: TrainingRecordCreateInput,
  ): Promise<TResponse>;
}

export type CustomerSuccessRequestInput = {
  category:
    | "GENERAL"
    | "TRAINING"
    | "MIGRATION"
    | "INTEGRATION"
    | "BILLING"
    | "INCIDENT";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  subject: string;
  description: string;
};

export interface CustomerSuccessApi {
  getProfile<TResponse = unknown>(): Promise<TResponse>;
  listRequests<TResponse = unknown>(): Promise<TResponse>;
  createRequest<TResponse = unknown>(
    input: CustomerSuccessRequestInput,
  ): Promise<TResponse>;
}

export type CalibrationRequestsListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: string;
};

export type CalibrationRequestActionInput = {
  internalNotes?: string;
};

export type CalibrationRequestConvertInput = {
  items: Array<{
    itemId: number;
    serviceId: number;
    technicianId?: string;
    dueDate?: string;
  }>;
  // On-site only: schedule one visit for the whole conversion (the trip).
  visit?: {
    scheduledAt?: string | null;
    technicianId?: string | null;
  } | null;
};

export interface CalibrationRequestsApi {
  list<TResponse = unknown>(
    input: CalibrationRequestsListInput,
  ): Promise<TResponse>;
  get<TResponse = unknown>(id: string | number): Promise<TResponse>;
  review<TResponse = unknown>(
    id: string | number,
    input?: CalibrationRequestActionInput,
  ): Promise<TResponse>;
  approve<TResponse = unknown>(
    id: string | number,
    input?: CalibrationRequestActionInput,
  ): Promise<TResponse>;
  reject<TResponse = unknown>(
    id: string | number,
    input: CalibrationRequestActionInput & { reason: string },
  ): Promise<TResponse>;
  convert<TResponse = unknown>(
    id: string | number,
    input: CalibrationRequestConvertInput,
  ): Promise<TResponse>;
}

// — On-site visits (calibração in loco) —————————————————————————————————————

export type VisitsListInput = {
  page?: number;
  limit?: number;
  status?: string;
  technicianId?: string;
  dateFrom?: string;
  dateTo?: string;
  mine?: boolean;
  rescheduleRequested?: boolean;
};

export type VisitAssignInput = { technicianId: string };

export type VisitConfirmInput = {
  scheduledAt?: string | null;
  technicianId?: string | null;
};

export type VisitRescheduleInput = {
  scheduledAt?: string | null;
  scheduledEndAt?: string | null;
  address?: unknown;
  notes?: string | null;
};

export type VisitCancelInput = { reason?: string | null };

export type VisitAddJobInput = {
  assetId: number;
  serviceId: number;
};

export type VisitAcceptRescheduleRequestInput = {
  scheduledAt: string;
  scheduledEndAt?: string | null;
  resolutionNote?: string | null;
};

export type VisitDeclineRescheduleRequestInput = {
  resolutionNote?: string | null;
};

export interface VisitsApi {
  list<TResponse = unknown>(input?: VisitsListInput): Promise<TResponse>;
  get<TResponse = unknown>(id: string | number): Promise<TResponse>;
  assign<TResponse = unknown>(
    id: string | number,
    input: VisitAssignInput,
  ): Promise<TResponse>;
  confirm<TResponse = unknown>(
    id: string | number,
    input?: VisitConfirmInput,
  ): Promise<TResponse>;
  reschedule<TResponse = unknown>(
    id: string | number,
    input: VisitRescheduleInput,
  ): Promise<TResponse>;
  cancel<TResponse = unknown>(
    id: string | number,
    input?: VisitCancelInput,
  ): Promise<TResponse>;
  complete<TResponse = unknown>(id: string | number): Promise<TResponse>;
  addJob<TResponse = unknown>(
    id: string | number,
    input: VisitAddJobInput,
  ): Promise<TResponse>;
  removeJob<TResponse = unknown>(
    id: string | number,
    jobId: string | number,
  ): Promise<TResponse>;
  acceptRescheduleRequest<TResponse = unknown>(
    id: string | number,
    requestId: string | number,
    input: VisitAcceptRescheduleRequestInput,
  ): Promise<TResponse>;
  declineRescheduleRequest<TResponse = unknown>(
    id: string | number,
    requestId: string | number,
    input?: VisitDeclineRescheduleRequestInput,
  ): Promise<TResponse>;
}

export interface IntegrationsApi {
  list<TResponse = unknown>(): Promise<TResponse>;
  create<TResponse = unknown>(input: unknown): Promise<TResponse>;
  startContaAzulOAuth<TResponse = unknown>(input: unknown): Promise<TResponse>;
  validate<TResponse = unknown>(id: string): Promise<TResponse>;
  update<TResponse = unknown>(id: string, input: unknown): Promise<TResponse>;
  updateContaAzulConfig<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  listContaAzulCatalog<TResponse = unknown>(
    id: string,
    catalog:
      | "accounts"
      | "balances"
      | "categories"
      | "cost-centers"
      | "dre-categories"
      | "product-categories"
      | "product-cest"
      | "product-ecommerce-brands"
      | "product-ecommerce-categories"
      | "product-ncm"
      | "products"
      | "product-units"
      | "sellers"
      | "services"
      | "transfers",
  ): Promise<TResponse>;
  pollContaAzul<TResponse = unknown>(
    id: string,
    input?: unknown,
  ): Promise<TResponse>;
  pollContaAzulFiscal<TResponse = unknown>(
    id: string,
    input?: unknown,
  ): Promise<TResponse>;
  linkContaAzulInvoicesToMdfe<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  pollContaAzulPayables<TResponse = unknown>(
    id: string,
    input?: unknown,
  ): Promise<TResponse>;
  pollContaAzulProtocols<TResponse = unknown>(
    id: string,
    input?: unknown,
  ): Promise<TResponse>;
  pollContaAzulDrift<TResponse = unknown>(
    id: string,
    input?: unknown,
  ): Promise<TResponse>;
  getContaAzulSchedule<TResponse = unknown>(id: string): Promise<TResponse>;
  refreshContaAzul<TResponse = unknown>(id: string): Promise<TResponse>;
  disconnectContaAzul<TResponse = unknown>(id: string): Promise<TResponse>;
  toggle<TResponse = unknown>(
    id: string,
    input: { enabled: boolean },
  ): Promise<TResponse>;
  previewSync<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  sync<TResponse = unknown>(id: string, input: unknown): Promise<TResponse>;
  schedule<TResponse = unknown>(id: string, input: unknown): Promise<TResponse>;
  listRunItems<TResponse = unknown>(
    id: string,
    runId: string,
  ): Promise<TResponse>;
  retryRun<TResponse = unknown>(id: string, runId: string): Promise<TResponse>;
  listDrift<TResponse = unknown>(input?: {
    target?: string;
  }): Promise<TResponse>;
  acknowledgeDrift<TResponse = unknown>(
    linkId: string,
    input: { reason: string },
  ): Promise<TResponse>;
}

export interface ServiceOrdersApi {
  list(input: ServiceOrdersListInput): Promise<ServiceOrdersListData>;
  get(id: string | number): Promise<ServiceOrderDetail>;
  listCommunications(
    id: string | number,
  ): Promise<ServiceOrderCommunicationsData>;
  create(input: CreateServiceOrderInput): Promise<CreateServiceOrderResult>;
  update(
    id: string | number,
    input: UpdateServiceOrderInput,
  ): Promise<{ data: ServiceOrderDetail }>;
  createQuote(
    id: string | number,
    input: CreateServiceOrderQuoteInput,
  ): Promise<unknown>;
  saveEvaluation(
    id: string | number,
    evaluationId: string | number | null,
    input: SaveServiceOrderEvaluationInput,
  ): Promise<unknown>;
  sendQuote(
    id: string | number,
    quoteId: string | number,
    input: SendServiceOrderQuoteInput,
  ): Promise<unknown>;
  saveExecution(
    id: string | number,
    input: SaveServiceOrderExecutionInput,
  ): Promise<unknown>;
  generateIntakeDocument(id: string | number): Promise<unknown>;
  getIntakeDocumentPdf(id: string | number): Promise<ServiceOrderDocumentUrl>;
  generateTag(id: string | number): Promise<unknown>;
  getTagPdf(id: string | number): Promise<ServiceOrderDocumentUrl>;
  updateRepairMark(
    id: string | number,
    input: ServiceOrderRepairMarkInput,
  ): Promise<unknown>;
  deliver(
    id: string | number,
    input: DeliverServiceOrderInput,
  ): Promise<unknown>;
  issueDeliveryDocument(
    id: string | number,
    input: IssueServiceOrderDeliveryDocumentInput,
  ): Promise<unknown>;
  getDeliveryDocumentPdf(id: string | number): Promise<ServiceOrderDocumentUrl>;
}

export type DashboardJobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "SUPERSEDED";

export type DashboardJob = {
  id: number;
  jobId: string;
  customerName: string | null;
  assetName: string | null;
  serviceName: string | null;
  technicianName: string | null;
  status: DashboardJobStatus;
  dueDate: string | null;
  isOverdue: boolean | null;
  createdAt: string;
};

export type DashboardStats = {
  pendingCalibrations: number;
  approvedThisMonth: number;
  rejectedThisMonth: number;
  approvalRate: number;
  expiringStandards: number;
  overdueJobs: number;
  dueToday: number;
  dueNextSevenDays: number;
  statusBreakdown: Array<{ status: DashboardJobStatus; count: number }>;
  reviewQueue: DashboardJob[];
  standardsWatchlist: Array<{
    id: number;
    name: string;
    serialNumber: string;
    certificateNumber: string;
    nextCalibrationDate: string;
    status: string;
  }>;
  calibrationTrend: Array<{ date: string; approved: number; rejected: number }>;
  recentJobs: DashboardJob[];
  // Cross-domain operational signals (org-scoped)
  openNonConformances: number;
  nonConformancesAwaitingDisposition: number;
  capasOpen: number;
  capasOverdue: number;
  pendingCalibrationRequests: number;
  serviceOrdersInProgress: number;
  competencesExpiring: number;
  competencesPendingEvaluation: number;
  ptPlanOverdue: number;
  ptRoundsPending: number;
  spcChartsWithSignals: number;
  dueSoonJobs: DashboardJob[];
};

export interface DashboardApi {
  getStats<TStats = DashboardStats>(): Promise<TStats>;
}

export type DashboardUnitSummary = {
  id: number;
  name: string;
  slug: string;
  role: string;
};

export type DashboardUnitsResponse = {
  activeUnitId: number | null;
  activeUnitName: string | null;
  selectedUnitScope: "all" | "unit";
  canAccessAllUnits: boolean;
  data: DashboardUnitSummary[];
  viewer?: {
    isGlobalManager: boolean;
    canManageOrganizationUnits: boolean;
    canManageAssignments: boolean;
    canManageGlobalRoles: boolean;
    canViewGovernance: boolean;
    canAccessConsolidatedView: boolean;
    managedUnitIds: number[];
  };
  scopeSummary?: {
    isConsolidated: boolean;
    activeUnitId: number | null;
    activeUnitName: string | null;
    accessibleUnitsCount: number;
    managedUnitsCount: number;
    effectiveRole: string;
    effectiveRoleLabel: string;
    label: string;
    description: string;
  };
};

export interface UnitsApi {
  getDashboardUnits(): Promise<DashboardUnitsResponse | null>;
  listAdminUnits<TResponse = unknown>(): Promise<TResponse>;
  listAdminMembers<TResponse = unknown>(): Promise<TResponse>;
  listAdminActivity<TResponse = unknown>(): Promise<TResponse>;
  createAdminUnit<TResponse = unknown>(name: string): Promise<TResponse>;
  updateAdminUnit<TResponse = unknown>(
    unitId: number,
    payload: { name?: string; status?: "ACTIVE" | "ARCHIVED" },
  ): Promise<TResponse>;
  updateMemberAssignments<TResponse = unknown>(
    memberId: string,
    assignments: Array<{
      unitId: number;
      role: "member" | "technician" | "unit_admin";
    }>,
  ): Promise<TResponse>;
  updateMemberRole<TResponse = unknown>(
    memberId: string,
    role: string,
  ): Promise<TResponse>;
}

export type PlanAccessResponse = {
  planId: string;
  planName: string;
  status: string;
  limits: {
    certificates: number;
    users: number;
    storage: number;
  };
  entitlements: string[];
  hasFinancial: boolean;
  hasFinancialModule: boolean;
  canManageBilling: boolean;
  hasApi: boolean;
  hasCustomDomain: boolean;
  hasCustomTemplates: boolean;
  hasSso: boolean;
};

export type FinanceAccessResponse = {
  planId: string;
  planName: string;
  status: string;
  entitlements: string[];
  hasFinancialModule: boolean;
  hasFinancialIntegrations: boolean;
  canReadFinancial: boolean;
  canManageFinancial: boolean;
  canExportFinancial: boolean;
  role: string;
};

export interface AccessApi {
  getPlanAccess(): Promise<PlanAccessResponse>;
  getFinanceAccess(): Promise<FinanceAccessResponse>;
}

export interface FinanceApi {
  getOverview<TResponse = unknown>(): Promise<TResponse>;
  listDocuments<TResponse = unknown>(input?: {
    query?: string;
  }): Promise<TResponse>;
  getDocument<TResponse = unknown>(id: string | number): Promise<TResponse>;
  updateDocument<TResponse = unknown>(
    id: string | number,
    input: unknown,
  ): Promise<TResponse>;
  issueDocument<TResponse = unknown>(id: string | number): Promise<TResponse>;
  voidDocument<TResponse = unknown>(
    id: string | number,
    input: { reason: string },
  ): Promise<TResponse>;
  listEligibleJobs<TResponse = unknown>(input: {
    mode: string;
    query?: string;
    limit?: string | number;
  }): Promise<TResponse>;
  createDocument<TResponse = unknown>(input: unknown): Promise<TResponse>;
  listContracts<TResponse = unknown>(input?: {
    query?: string;
  }): Promise<TResponse>;
  getContract<TResponse = unknown>(id: string | number): Promise<TResponse>;
  createContract<TResponse = unknown>(input: unknown): Promise<TResponse>;
  activateContract<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  cancelContract<TResponse = unknown>(id: string | number): Promise<TResponse>;
  listReceipts<TResponse = unknown>(): Promise<TResponse>;
  receiveInstallment<TResponse = unknown>(
    id: string | number,
    input: unknown,
  ): Promise<TResponse>;
  listErpExports<TResponse = unknown>(): Promise<TResponse>;
  exportErpDocument<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  listBillingReadiness<TResponse = unknown>(input?: {
    status?: string;
    customerId?: string | number;
  }): Promise<TResponse>;
  sendBillingReadiness<TResponse = unknown>(input: {
    serviceOrderIds: number[];
  }): Promise<TResponse>;
  getServiceOrderStatus<TResponse = unknown>(
    serviceOrderId: string | number,
  ): Promise<TResponse>;
  getCustomerTimeline<TResponse = unknown>(
    customerId: string | number,
    input?: { limit?: string | number },
  ): Promise<TResponse>;
  getCertificateRelease<TResponse = unknown>(
    calibrationJobId: string | number,
  ): Promise<TResponse>;
  releaseCertificateByException<TResponse = unknown>(
    calibrationJobId: string | number,
    input: { reason: string },
  ): Promise<TResponse>;
  listCertificateReleasePolicies<TResponse = unknown>(): Promise<TResponse>;
  createCertificateReleasePolicy<TResponse = unknown>(input: {
    mode: string;
    customerId?: number | null;
    commercialAgreementId?: number | null;
    serviceCategory?: string | null;
    priority?: number;
  }): Promise<TResponse>;
  updateCertificateReleasePolicy<TResponse = unknown>(
    id: string | number,
    input: { mode?: string; archived?: boolean; priority?: number },
  ): Promise<TResponse>;
  listAutomaticSendRules<TResponse = unknown>(): Promise<TResponse>;
  createAutomaticSendRule<TResponse = unknown>(input: {
    milestone: string;
    customerId?: number | null;
    commercialAgreementId?: number | null;
    serviceCategory?: string | null;
    priority?: number;
  }): Promise<TResponse>;
  updateAutomaticSendRule<TResponse = unknown>(
    id: string | number,
    input: { milestone?: string; archived?: boolean; priority?: number },
  ): Promise<TResponse>;
  getOperationsToCash<TResponse = unknown>(input?: {
    stage?: string;
  }): Promise<TResponse>;
  getRevenueLeakage<TResponse = unknown>(): Promise<TResponse>;
  getCashForecast<TResponse = unknown>(): Promise<TResponse>;
  getMarginDashboards<TResponse = unknown>(): Promise<TResponse>;
}

export interface SessionsApi {
  revoke(sessionId: string): Promise<unknown>;
}

export type BillingSubscriptionSummary = {
  id: number | string;
  planId: string;
  status: string;
  billingCycle?: string | null;
  currentPeriodStart?: string | Date | null;
  currentPeriodEnd?: string | Date | null;
  nextBillingDate?: string | Date | null;
  canceledAt?: string | Date | null;
  createdAt?: string | Date | null;
};

export type BillingPlanSummary = {
  id: string;
  name: string;
  description?: string;
  recommendedFor?: string;
};

export type BillingUsageSummary = {
  jobsCreated: number;
  users: number;
  storage: number;
};

export type BillingLimitsSummary = {
  certificates: number;
  users: number;
  storage: number;
};

export type BillingSubscriptionResponse = {
  subscription: BillingSubscriptionSummary | null;
  plan: BillingPlanSummary | null;
  usage: BillingUsageSummary;
  limits: BillingLimitsSummary;
};

export type BillingPaymentRecord = {
  id: number;
  amount: number;
  status: string;
  paymentMethod: string;
  createdAt: string | Date;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
};

export type BillingPaymentsResponse = {
  data: BillingPaymentRecord[];
};

export interface BillingApi {
  getSubscription(): Promise<BillingSubscriptionResponse>;
  listPayments(input?: {
    limit?: number;
    offset?: number;
  }): Promise<BillingPaymentsResponse>;
}

export type BackofficeAccessResponse = {
  allowed: boolean;
  roles?: string[];
  bootstrapAvailable: boolean;
  isImpersonating?: boolean;
  session?: {
    userId: string;
    email: string;
  };
};

export type BackofficeBootstrapInput = {
  token: string;
  name?: string;
  email?: string;
  password?: string;
};

export interface BackofficeApi {
  getAccess(): Promise<BackofficeAccessResponse>;
  bootstrap<TResponse = unknown>(
    input: BackofficeBootstrapInput,
  ): Promise<TResponse>;
  listOrganizations<TResponse = unknown>(): Promise<TResponse>;
  getOrganization<TResponse = unknown>(id: string): Promise<TResponse>;
  getSupportQueue<TResponse = unknown>(): Promise<TResponse>;
  listUsers<TResponse = unknown>(
    input?: Record<string, unknown>,
  ): Promise<TResponse>;
  updateUserRole<TResponse = unknown>(
    id: string,
    role: string,
  ): Promise<TResponse>;
  banUser<TResponse = unknown>(id: string): Promise<TResponse>;
  unbanUser<TResponse = unknown>(id: string): Promise<TResponse>;
  impersonateUser<TResponse = unknown>(
    id: string,
    reason: string,
  ): Promise<TResponse>;
  createUser<TResponse = unknown>(input: unknown): Promise<TResponse>;
  provisionLab<TResponse = unknown>(input: unknown): Promise<TResponse>;
  requestUserPasswordReset<TResponse = unknown>(id: string): Promise<TResponse>;
  getUser<TResponse = unknown>(id: string): Promise<TResponse>;
  listUserSessions<TResponse = unknown>(id: string): Promise<TResponse>;
  revokeUserSession<TResponse = unknown>(
    id: string,
    sessionId: string,
  ): Promise<TResponse>;
  listUserActivity<TResponse = unknown>(
    id: string,
    input?: Record<string, unknown>,
  ): Promise<TResponse>;
  getPresence<TResponse = unknown>(): Promise<TResponse>;
  listAuditLog<TResponse = unknown>(
    input?: Record<string, unknown>,
  ): Promise<TResponse>;
  getIntegrationHealth<TResponse = unknown>(): Promise<TResponse>;
  getVitals<TResponse = unknown>(): Promise<TResponse>;
  listOperatorAlerts<TResponse = unknown>(
    input?: Record<string, unknown>,
  ): Promise<TResponse>;
  recomputeOperatorAlerts<TResponse = unknown>(): Promise<TResponse>;
  acknowledgeOperatorAlert<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  listAccountTasks<TResponse = unknown>(
    input?: Record<string, unknown>,
  ): Promise<TResponse>;
  createAccountTask<TResponse = unknown>(input: unknown): Promise<TResponse>;
  completeAccountTask<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  updateOrganizationLifecycle<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  listInteractions<TResponse = unknown>(id: string): Promise<TResponse>;
  createInteraction<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  manageSubscription<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  listEntitlementOverrides<TResponse = unknown>(id: string): Promise<TResponse>;
  grantEntitlementOverride<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  revokeEntitlementOverride<TResponse = unknown>(
    id: string | number,
  ): Promise<TResponse>;
  getOrganizationActivity<TResponse = unknown>(id: string): Promise<TResponse>;
  listImportRuns<TResponse = unknown>(id: string): Promise<TResponse>;
  parseImportFile<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  validateImportRun<TResponse = unknown>(
    id: string,
    input: unknown,
  ): Promise<TResponse>;
  listApprovals<TResponse = unknown>(
    input?: Record<string, unknown>,
  ): Promise<TResponse>;
  createApprovalRequest<TResponse = unknown>(
    input: unknown,
  ): Promise<TResponse>;
  decideApproval<TResponse = unknown>(
    id: string | number,
    input: unknown,
  ): Promise<TResponse>;
  commercial: {
    listOrganizations<TResponse = unknown>(search?: string): Promise<TResponse>;
    getContext<TResponse = unknown>(organizationId: string): Promise<TResponse>;
    syncBillingCustomer<TResponse = unknown>(
      input: unknown,
    ): Promise<TResponse>;
    createBillingContact<TResponse = unknown>(
      input: unknown,
    ): Promise<TResponse>;
    previewOffer<TResponse = unknown>(input: unknown): Promise<TResponse>;
    issueOffer<TResponse = unknown>(input: unknown): Promise<TResponse>;
    cancelOffer<TResponse = unknown>(
      offerId: string,
      input: { reason: string; approvalRequestId?: number },
    ): Promise<TResponse>;
    reissueOffer<TResponse = unknown>(
      offerId: string,
      input: unknown,
    ): Promise<TResponse>;
  };
  customerSuccess: {
    listOrganizations<TResponse = unknown>(): Promise<TResponse>;
    getProfile<TResponse = unknown>(organizationId: string): Promise<TResponse>;
    getRequests<TResponse = unknown>(
      organizationId: string,
    ): Promise<TResponse>;
    updateProfile<TResponse = unknown>(
      organizationId: string,
      input: unknown,
    ): Promise<TResponse>;
    updateRequestStatus<TResponse = unknown>(
      requestId: string | number,
      input: unknown,
    ): Promise<TResponse>;
    assignRequest<TResponse = unknown>(
      requestId: string | number,
      input: unknown,
    ): Promise<TResponse>;
    respondRequest<TResponse = unknown>(
      requestId: string | number,
      input: unknown,
    ): Promise<TResponse>;
    escalateRequest<TResponse = unknown>(
      requestId: string | number,
      input: unknown,
    ): Promise<TResponse>;
    updateNextAction<TResponse = unknown>(
      organizationId: string,
      input: unknown,
    ): Promise<TResponse>;
    updateBlocker<TResponse = unknown>(
      organizationId: string,
      input: unknown,
    ): Promise<TResponse>;
  };
  stopImpersonation(): Promise<{ ok: true }>;
}

export type StartSsoInput = {
  organizationSlug: string;
  email?: string;
  redirectPath?: string;
};

export type StartSsoResponse = {
  url: string;
  redirect?: boolean;
};

export type SsoVerificationRecord = {
  type: "TXT";
  host: string;
  value: string;
};

export type SsoProviderSummary = {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  domainHost: string;
  domainVerified: boolean;
  organizationId: string | null;
  type: string;
  redirectURI: string;
  oidcConfig: {
    discoveryEndpoint: string | null;
    authorizationEndpoint: string | null;
    tokenEndpoint: string | null;
    userInfoEndpoint: string | null;
    jwksEndpoint: string | null;
    scopes: string[];
    pkce: boolean;
    clientIdLastFour: string | null;
    tokenEndpointAuthentication: string | null;
  } | null;
};

export type SsoSettingsResponse = {
  provider: SsoProviderSummary | null;
  access: {
    role: string;
    canCreate: boolean;
    canManage: boolean;
    canDelete: boolean;
  };
  billing: {
    planId: string;
    planName: string;
    status: string;
    hasSso: boolean;
  };
};

export type CreateSsoProviderInput = {
  providerId: string;
  issuer: string;
  domain: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
};

export type CreateSsoProviderResponse = {
  provider: SsoProviderSummary;
  verificationRecord: SsoVerificationRecord | null;
};

export type RequestSsoDomainVerificationResponse = {
  verificationRecord: SsoVerificationRecord;
};

export type VerifySsoDomainResponse = {
  provider: SsoProviderSummary;
};

export interface SsoApi {
  start(input: StartSsoInput): Promise<StartSsoResponse>;
  getProviders(): Promise<SsoSettingsResponse>;
  createProvider(
    input: CreateSsoProviderInput,
  ): Promise<CreateSsoProviderResponse>;
  requestDomainVerification(
    providerId: string,
  ): Promise<RequestSsoDomainVerificationResponse>;
  verifyDomain(providerId: string): Promise<VerifySsoDomainResponse>;
  deleteProvider(providerId: string): Promise<void>;
}

export type ApiKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | Date | null;
  createdAt: string | Date;
  revokedAt: string | Date | null;
};

export type ApiKeysListResponse = {
  data: ApiKeySummary[];
};

export type CreateApiKeyInput = {
  name: string;
  scopes?: string[];
};

export type ApiKeySecretResponse = {
  secret: string;
  key: Pick<ApiKeySummary, "id" | "name" | "keyPrefix" | "scopes">;
};

export interface ApiKeysApi {
  list(): Promise<ApiKeysListResponse>;
  create(input: CreateApiKeyInput): Promise<ApiKeySecretResponse>;
  rotate(id: string): Promise<ApiKeySecretResponse>;
  revoke(id: string): Promise<{ success: boolean }>;
}

export type EntityLabelResponse = {
  label?: string | null;
};

export interface EntityLabelsApi {
  getNonConformance(id: string | number): Promise<string | null>;
  getCapa(id: string | number): Promise<string | null>;
  getCompetence(id: string | number): Promise<string | null>;
}

export type CertificateNumberingResetScope =
  | "never"
  | "year"
  | "month"
  | "project";

export type CertificateNumberingConfig = {
  labCode: string;
  projectCode?: string | null;
  numberTemplate: string;
  certificateNameTemplate: string;
  sequence: {
    resetScope: CertificateNumberingResetScope;
    startAt: number;
    increment: number;
    padding: number;
  };
};

export type CertificateNumberingProfileResponse = {
  profile: {
    id: number | null;
    name: string;
    config: CertificateNumberingConfig;
    createdAt: string | Date | null;
    updatedAt: string | Date | null;
  };
  example: {
    number: string;
    name: string;
    sequenceKey: string;
  };
  supportedTokens: string[];
};

export type UpdateCertificateNumberingProfileResponse = {
  message: string;
  profile: {
    id: number;
    name: string;
    config: CertificateNumberingConfig;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
  };
};

export interface CertificateNumberingApi {
  getProfile(): Promise<CertificateNumberingProfileResponse>;
  updateProfile(
    input: UpdateCertificateNumberingProfileInput,
  ): Promise<UpdateCertificateNumberingProfileResponse>;
}

export type PortalDomainStatus =
  | "not_configured"
  | "waiting_dns"
  | "token_mismatch"
  | "ready_to_verify"
  | "verified"
  | "active";

export type PortalDomainResponse = {
  portalBaseUrl: string;
  domain: {
    id: string;
    hostname: string;
    verifiedAt: string | Date | null;
    activatedAt: string | Date | null;
    lastVerifiedAt: string | Date | null;
    isActive: boolean;
    verification: { type: "TXT"; host: string; value: string };
  } | null;
  statusSummary: {
    status: PortalDomainStatus;
    readiness: "not_ready" | "ready" | "active";
    canActivate: boolean;
    message: string;
    diagnostics: {
      host: string | null;
      expectedValue: string | null;
      observedValues: string[];
    };
  };
};

export type PortalDomainActionResponse =
  | PortalDomainResponse
  | {
      message?: string;
    };

export interface PortalDomainsApi {
  get(): Promise<PortalDomainResponse>;
  create(input: { hostname: string }): Promise<PortalDomainActionResponse>;
  verify(): Promise<PortalDomainActionResponse>;
  activate(): Promise<PortalDomainActionResponse>;
  delete(): Promise<void>;
}

export type EmailDomainStatus =
  | "not_configured"
  | "waiting_verification"
  | "verified"
  | "active";

export type EmailDomainKeyStatus = "ok" | "invalid" | "rate_limited";

export type EmailDomainRecord = {
  id: string;
  mode: "byok" | "managed";
  hostname: string;
  fromAddress: string;
  status: string;
  verifiedAt: string | Date | null;
  lastVerifiedAt: string | Date | null;
  activatedAt: string | Date | null;
  isActive: boolean;
  keyStatus: EmailDomainKeyStatus;
  keyLastError: string | null;
  /** Masked representation; the raw key never leaves the server. */
  apiKeyMasked: string;
  dnsRecords: Record<string, unknown>[];
  createdAt: string | Date;
};

export type EmailDomainResponse = {
  domain: EmailDomainRecord | null;
  statusSummary: {
    status: EmailDomainStatus;
    canActivate: boolean;
    message: string;
    keyHealth: { status: EmailDomainKeyStatus; lastError: string | null };
  };
  /**
   * Where customer replies land (Reply-To = organization.email). Present on
   * GET only; null means replies would be lost — the settings page warns.
   */
  replyToEmail?: string | null;
};

export type EmailDomainValidateKeyResponse = {
  valid: boolean;
  domains?: { id: string; name: string; status: string }[];
};

export interface EmailDomainsApi {
  get(): Promise<EmailDomainResponse>;
  validateKey(input: {
    apiKey: string;
  }): Promise<EmailDomainValidateKeyResponse>;
  create(input: {
    apiKey: string;
    resendDomainId: string;
    fromLocalPart: string;
  }): Promise<EmailDomainResponse>;
  rotateKey(input: { apiKey: string }): Promise<EmailDomainResponse>;
  verify(): Promise<EmailDomainResponse>;
  activate(): Promise<EmailDomainResponse>;
  delete(): Promise<void>;
}

export type NotificationSummary = {
  id: number;
  type: string;
  priority: string;
  status: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  createdAt: string;
};

export type NotificationsListResponse = {
  data: NotificationSummary[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type UnreadNotificationsResponse = {
  count: number;
};

export type NotificationPreference = {
  inApp: boolean;
  email: boolean;
};

export type NotificationPreferencesMap = Record<string, NotificationPreference>;

export type NotificationPreferencesResponse = {
  preferences: NotificationPreferencesMap;
  emailEnabled: boolean;
  notifySelfActions: boolean;
  digestFrequency: "NONE" | "DAILY" | "WEEKLY";
};

export interface NotificationsApi {
  getUnreadCount(): Promise<UnreadNotificationsResponse>;
  listRecent(input?: {
    page?: number;
    limit?: number;
  }): Promise<NotificationsListResponse>;
  markRead(notificationIds: number[]): Promise<unknown>;
  markAllRead(): Promise<unknown>;
  getPreferences(): Promise<NotificationPreferencesResponse>;
  updatePreferences(
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferencesResponse>;
}

export type SignatureImageDimensions = {
  width: number;
  height: number;
};

export type MySignatureResponse =
  | {
      hasSignature: false;
    }
  | {
      hasSignature: true;
      url: string;
      dimensions: SignatureImageDimensions;
      uploadedAt?: string | Date | null;
    };

export type SignatureUploadResponse = {
  message: string;
  dimensions: SignatureImageDimensions;
};

export type SignatureDeleteResponse = {
  message: string;
};

export interface SignaturesApi {
  getMine(): Promise<MySignatureResponse>;
  uploadMine(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<SignatureUploadResponse>;
  deleteMine(): Promise<SignatureDeleteResponse>;
}

export type ProfileAvatarUploadResponse = {
  imageUrl: string;
};

export type ProfileAvatarDeleteResponse = {
  success: boolean;
};

export interface ProfileMediaApi {
  uploadAvatar(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<ProfileAvatarUploadResponse>;
  deleteAvatar(): Promise<ProfileAvatarDeleteResponse>;
}

export type OrganizationLogoUploadResponse = {
  logoUrl: string;
};

export type OrganizationLogoDeleteResponse = {
  logoUrl: null;
};

export interface OrganizationMediaLibraryItem {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string | null;
}

export interface OrganizationMediaApi {
  uploadLogo(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<OrganizationLogoUploadResponse>;
  deleteLogo(): Promise<OrganizationLogoDeleteResponse>;
  listLibrary(): Promise<{ items: OrganizationMediaLibraryItem[] }>;
  uploadLibrary(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<{ item: OrganizationMediaLibraryItem }>;
  deleteLibrary(mediaId: number): Promise<{ ok: boolean }>;
}

export type SigningCertificateStatus =
  | "valid"
  | "expired"
  | "not_yet_valid"
  | "revoked";

export type SigningCertificate = {
  id: number;
  unitId: number;
  name: string;
  serialNumber: string;
  issuerCn: string;
  subjectCn: string;
  subjectCpfCnpj?: string | null;
  validFrom: string | Date;
  validUntil: string | Date;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string | Date;
  createdByName: string | null;
  revokedAt: string | Date | null;
  revokedReason: string | null;
  status: SigningCertificateStatus;
};

export type SigningCertificatesListResponse = {
  certificates: SigningCertificate[];
  unit?: unknown;
  /** #644: the unit's "assinatura obrigatória" policy flag. */
  requireSignature?: boolean;
};

export type UploadSigningCertificateInput = {
  name: string;
  p12Base64: string;
  password: string;
  setAsDefault: boolean;
};

export type UploadSigningCertificateResponse = {
  message: string;
  certificate: {
    id: number;
    unitId: number;
    name: string;
    serialNumber: string;
    issuerCn: string;
    subjectCn: string;
    validFrom: string | Date;
    validUntil: string | Date;
    isDefault: boolean;
  };
};

export type SigningCertificateActionResponse = {
  message: string;
};

export interface SigningCertificatesApi {
  list(): Promise<SigningCertificatesListResponse>;
  upload(
    input: UploadSigningCertificateInput,
  ): Promise<UploadSigningCertificateResponse>;
  setDefault(id: string | number): Promise<SigningCertificateActionResponse>;
  revoke(
    id: string | number,
    reason: string,
  ): Promise<SigningCertificateActionResponse>;
  /** #644: set the unit's "assinatura obrigatória" policy. */
  setPolicy(requireSignature: boolean): Promise<{ requireSignature: boolean }>;
}

export interface PublicInvitationsApi {
  get<TResponse = unknown>(id: string): Promise<TResponse>;
  requestSetupLink<TResponse = unknown>(id: string): Promise<TResponse>;
}

export type LabSetupMetadata = {
  status:
    | "ready"
    | "invalid"
    | "expired"
    | "consumed"
    | "user_invalid"
    | "email_mismatch"
    | "organization_invalid"
    | "membership_missing"
    | "invitation_invalid";
  email?: string;
  organizationName?: string;
  organizationSlug?: string;
  expiresAt?: string | Date;
  passkeyPreferred: boolean;
  fallbackMethods: Array<"magic_link" | "email_otp">;
};

export interface LabSetupApi {
  get(token: string): Promise<LabSetupMetadata>;
  requestMagicLink<TResponse = unknown>(token: string): Promise<TResponse>;
  requestOtp<TResponse = unknown>(token: string): Promise<TResponse>;
  complete<TResponse = unknown>(token: string): Promise<TResponse>;
}

export interface CalibraApi {
  dashboard: DashboardApi;
  units: UnitsApi;
  access: AccessApi;
  sessions: SessionsApi;
  finance: FinanceApi;
  billing: BillingApi;
  backoffice: BackofficeApi;
  sso: SsoApi;
  apiKeys: ApiKeysApi;
  entityLabels: EntityLabelsApi;
  certificateNumbering: CertificateNumberingApi;
  portalDomains: PortalDomainsApi;
  emailDomains: EmailDomainsApi;
  notifications: NotificationsApi;
  signatures: SignaturesApi;
  profileMedia: ProfileMediaApi;
  organizationMedia: OrganizationMediaApi;
  signingCertificates: SigningCertificatesApi;
  customers: CustomersApi;
  customerGroups: CustomerGroupsApi;
  assets: AssetsApi;
  assetTypes: AssetTypesApi;
  services: ServicesApi;
  materials: MaterialsApi;
  methods: MethodsApi;
  standards: StandardsApi;
  jobs: JobsApi;
  serviceOrders: ServiceOrdersApi;
  sync: SyncApi;
  attachments: AttachmentsApi;
  environmentalLimits: EnvironmentalLimitsApi;
  accreditedScope: AccreditedScopeApi;
  reports: ReportsApi;
  publicCheckout: PublicCheckoutApi;
  publicInvitations: PublicInvitationsApi;
  publicLeads: PublicLeadsApi;
  labSetup: LabSetupApi;
  nonConformances: NonConformancesApi;
  capas: CapasApi;
  proficiencyTests: ProficiencyTestsApi;
  spc: SpcApi;
  certificateTemplates: CertificateTemplatesApi;
  competences: CompetencesApi;
  trainingRecords: TrainingRecordsApi;
  customerSuccess: CustomerSuccessApi;
  calibrationRequests: CalibrationRequestsApi;
  visits: VisitsApi;
  integrations: IntegrationsApi;
}
