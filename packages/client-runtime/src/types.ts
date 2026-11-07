// Request payload types derived from @calibra-facil/schemas — the client
// can no longer drift from what the API validates (e.g. the hand-written
// CreateJobInput was missing sourceServiceOrderId). z.input (not z.infer)
// keeps fields with schema defaults optional for callers, matching what
// the wire actually accepts.
import type { z } from "zod";
import type {
  AssetStatus,
  ReferenceStandardStatus,
} from "@calibra-facil/schemas/machines";
import type {
  AccreditedScopeLineSchema,
  AdjustMaterialStockSchema,
  CreateCustomerSchema,
  CreateCustomerGroupSchema,
  CreateJobSchema,
  CreateMaterialSchema,
  CreateNonConformanceSchema,
  CreateServiceOrderSchema,
  FromTemplateSchema,
  CreateServiceSchema,
  SoftDeleteOrganizationSchema,
  UpdateOrganizationProfileSchema,
  UpdateCustomerSchema,
  UpdateMaterialSchema,
  UpdateNotificationPreferencesSchema,
  UpdateServiceSchema,
} from "@calibra-facil/schemas";
import type { AccreditedScopeApi } from "./modules/accredited-scope";
import type { PortalDomainsApi } from "./modules/portal-domains";
import type { SigningCertificatesApi } from "./modules/signing-certificates";
import type { SsoApi } from "./modules/sso";
import type { CalibrationRequestsApi } from "./modules/calibration-requests";
import type { AssetsApi } from "./modules/assets";
import type { CertificateNumberingApi } from "./modules/certificate-numbering";
import type { CapasApi } from "./modules/capa";
import type { CompetencesApi } from "./modules/competences";
import type { CustomersApi } from "./modules/customers";
import type { DashboardApi } from "./modules/dashboard";
import type { NonConformancesApi } from "./modules/non-conformances";
import type { FinanceApi } from "./modules/finance";
import type { ProficiencyTestsApi } from "./modules/proficiency-tests";
import type { EnvironmentalLimitsApi } from "./modules/environmental-limits";
import type { MaterialsApi } from "./modules/materials";
import type { MethodsApi } from "./modules/methods";
import type { ReportsApi } from "./modules/reports";
import type { ServiceOrdersApi } from "./modules/service-orders";
import type { SignaturesApi } from "./modules/signatures";
import type { SpcApi } from "./modules/spc";
import type { TrainingRecordsApi } from "./modules/training-records";
import type { VisitsApi } from "./modules/visits";

export type AdjustMaterialStockInput = z.input<
  typeof AdjustMaterialStockSchema
>;
export type SoftDeleteOrganizationRequest = z.input<
  typeof SoftDeleteOrganizationSchema
>;
export type UpdateOrganizationProfileRequest = z.input<
  typeof UpdateOrganizationProfileSchema
>;
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
export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;
export type UpdateMaterialInput = z.input<typeof UpdateMaterialSchema>;
export type UpdateNotificationPreferencesInput = z.input<
  typeof UpdateNotificationPreferencesSchema
>;
export type UpdateServiceInput = z.input<typeof UpdateServiceSchema>;

export type ServiceAuditLogData<TRecord = unknown> = {
  data: TRecord[];
};

import type {
  PortalDomainResponse,
  SigningCertificate,
  SigningCertificatesListResponse,
  SsoSettingsResponse,
  SsoVerificationRecord,
  UnsignedIssuanceSetting,
  AssetAuditLogEntry,
  AssetDetail,
  AssetsListResponse,
  ServiceOrderCommunicationStatus,
  ServiceOrderDetail,
  ServiceOrdersListResponse,
  CertificateNumberingConfig,
  CertificateNumberingProfileResponse,
  CnpjLookupResult,
  DashboardJob,
  DashboardStats,
  MySignatureResponse,
  SignatureUploadResponse,
  UpdateCertificateNumberingProfileResponse,
  CustomerDetail,
  CustomersListResponse,
  MethodDetail,
  MethodGovernance,
  MethodsListResponse,
  MethodTemplateCatalogEntry,
  AccreditedScopeLine as ContractAccreditedScopeLine,
  AccreditedScopeResponse as ContractAccreditedScopeResponse,
  AdjustMaterialStockResponse,
  MaterialRecord,
  MaterialsListResponse,
  SaveAccreditedScopeLineResponse as ContractSaveAccreditedScopeLineResponse,
  ScopeEnforcementMode as ContractScopeEnforcementMode,
  EffectiveEnvironmentalLimitsResponse,
  JobAmendResponse,
  JobWithdrawCertificateResponse,
  JobCreateResponse,
  JobDetail,
  JobDownloadUrlResponse,
  JobExecutionResponse,
  JobFlagOotResponse,
  JobGenerateLabelResponse,
  JobMutationResponse,
  JobTechniciansResponse,
  JobsListResponse,
  JobStatus,
  LocalAttachment,
  LocalAttachmentsResponse,
  LocalBlockedOutboxEventsResponse,
  LocalDeadOutboxEvent,
  LocalDeadOutboxEventsResponse,
  LocalSessionSnapshotResponse,
  LocalSyncConflict,
  LocalSyncConflictsResponse,
  MassCompositionProfile,
  MassCompositionProfilesResponse,
  Standard,
  StandardCertificateDocumentDownloadResponse,
  StandardCertificateDocumentUploadResponse,
  StandardRecord,
  StandardsListResponse,
  SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import type { JobExecutionPayload } from "./jobs";
export type { JobExecutionPayload } from "./jobs";
export type {
  AssetRecord,
  EffectiveEnvironmentalLimitsResponse,
  EnvironmentalLimit,
  EnvironmentalLimitsResponse,
} from "@calibra-facil/contracts";
export type {
  LocalAttachment,
  LocalAttachmentsResponse,
  LocalBlockedOutboxEventsResponse,
  LocalDeadOutboxEvent,
  LocalDeadOutboxEventsResponse,
  LocalSessionSnapshotResponse,
  LocalSyncConflict,
  LocalSyncConflictsResponse,
} from "@calibra-facil/contracts";

export type JobsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  query?: string;
  status?: JobStatus;
};

/** POST /api/jobs answers with the created job row. */
type CreateJobResult = JobCreateResponse;

export interface JobsApi {
  list(input: JobsListInput): Promise<JobsListResponse>;
  create(input: CreateJobInput): Promise<CreateJobResult>;
  get(jobId: string | number): Promise<JobDetail>;
  listTechnicians(): Promise<JobTechniciansResponse>;
  approve(
    jobId: string | number,
    input: {
      reason: string;
      environmentalJustification?: string;
      scopeOverrideJustification?: string;
    },
  ): Promise<JobMutationResponse>;
  reject(jobId: string | number, reason: string): Promise<JobMutationResponse>;
  retryRender(jobId: string | number): Promise<JobMutationResponse>;
  cancel(jobId: string | number, reason: string): Promise<JobMutationResponse>;
  assign(
    jobId: string | number,
    technicianId: string,
  ): Promise<JobMutationResponse>;
  /** The active reference standards a worksheet can pick from. */
  listStandards(): Promise<StandardsListResponse>;
  getEffectiveEnvironmentalLimits(
    assetTypeId: string | number,
    input?: { unitId?: string | number | null },
  ): Promise<EffectiveEnvironmentalLimitsResponse>;
  saveExecution(
    jobId: string | number,
    input: JobExecutionPayload,
  ): Promise<JobExecutionResponse>;
  submitExecution(
    jobId: string | number,
    input: JobExecutionPayload,
  ): Promise<JobExecutionResponse>;
  getCertificateDownloadUrl(
    jobId: string | number,
  ): Promise<JobDownloadUrlResponse>;
  generateLabel(jobId: string | number): Promise<JobGenerateLabelResponse>;
  getLabelDownloadUrl(jobId: string | number): Promise<JobDownloadUrlResponse>;
  /** Native printer commands (ZPL/TSPL) for direct thermal printing (text). */
  getLabelCommands(
    jobId: string | number,
    options?: { language?: "zpl" | "tspl"; dpi?: 203 | 300 },
  ): Promise<string>;
  amend(jobId: string | number, reason: string): Promise<JobAmendResponse>;
  /**
   * §7.10: withdraws the issued certificate (admin/owner; a written reason is
   * mandatory). The job keeps its status; the certificate lifecycle becomes
   * WITHDRAWN and the verification page and the portal say so.
   */
  withdrawCertificate(
    jobId: string | number,
    reason: string,
  ): Promise<JobWithdrawCertificateResponse>;
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
  ): Promise<JobFlagOotResponse>;
}

/**
 * Outcome of a canonical reconciliation. Never an error: reconciliation runs
 * *after* a cloud command has already succeeded, so a failure here means the
 * local cache is briefly behind — not that the command did not happen. The UI
 * degrades to a "pending sync" hint instead of an action-failed toast.
 */
export type SyncReconcileResult = {
  reconciled: boolean;
  /** Populated when `reconciled` is false, for support surfaces. */
  reason?: string;
};

export interface SyncApi {
  getSession(): Promise<LocalSessionSnapshotResponse>;
  /**
   * Push queued local writes, pull canonical cloud state, and resolve once the
   * local cache reflects the server.
   *
   * Call this after any cloud command whose entity is read back local-first
   * (`local-first-read-through-sync`); otherwise the next read serves the
   * pre-command snapshot and the UI silently shows a stale status. A no-op in
   * the browser, where there is no local cache to reconcile.
   */
  reconcile(): Promise<SyncReconcileResult>;
  listConflicts(input?: {
    status?: LocalSyncConflict["status"];
    limit?: number;
  }): Promise<LocalSyncConflictsResponse>;
  /**
   * Decide a conflict. `resolved` keeps the local change (it is sent again);
   * `discarded_by_user` gives it up: recorded with who, when and why, kept for audit, never
   * sent. A change that carries calibration readings needs a `reason`.
   */
  resolveConflict(
    id: string,
    status?: "resolved" | "discarded_by_user",
    reason?: string,
  ): Promise<{ data: LocalSyncConflict }>;
  /** Events the cloud refused for good: out of the push queue, awaiting a decision. */
  listDeadEvents(): Promise<LocalDeadOutboxEventsResponse>;
  /** Changes held behind a refused or conflicting one: not sent until that one is resolved. */
  listBlockedEvents(): Promise<LocalBlockedOutboxEventsResponse>;
  /**
   * Drop a dead (or blocked) event from the queue. The local data it described stays; the
   * discard is recorded with who, when and the optional `reason`.
   */
  discardDeadEvent(
    eventId: string,
    reason?: string,
  ): Promise<{
    data: LocalDeadOutboxEvent;
    syncStatus: SyncStatusSnapshot;
  }>;
  /** Send a dead event again, once whatever the cloud refused it over is fixed. */
  requeueDeadEvent(eventId: string): Promise<{
    data: { eventId: string };
    syncStatus: SyncStatusSnapshot;
  }>;
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

// =============================================================================
// MATERIALS, ENVIRONMENTAL LIMITS, ACCREDITED SCOPE: the DTOs are the contract
// schemas' types (`@calibra-facil/contracts`, `endpoints/`); the clients are
// generated from the endpoint definitions (`modules/`).
// =============================================================================

export type MaterialsListData = MaterialsListResponse;
export type MaterialDetailData = MaterialRecord;
export type AdjustMaterialStockData = AdjustMaterialStockResponse;
export type { MaterialsApi };

// METHODS: the DTOs are the contract schemas' types (`endpoints/methods.ts`);
// the client is generated from the endpoint definitions (`modules/methods.ts`).
export type MethodsListData = MethodsListResponse;
export type MethodDetailData = MethodDetail;
export type { MethodGovernance, MethodTemplateCatalogEntry };
export type MethodFromTemplateInput = z.input<typeof FromTemplateSchema>;
export type { MethodsApi };

export type StandardStatus = ReferenceStandardStatus;

/** A standard as the list and the detail return it (contract type). */
export type StandardData = Standard;

export type StandardsListInput = {
  page?: number;
  limit?: number;
  query?: string;
  status?: StandardStatus;
};

export type StandardsListData = StandardsListResponse;

export type StandardWriteInput = Record<string, unknown>;

export type StandardAuditLogData<TRecord = unknown> = {
  data: TRecord[];
};

/** A row of the normalized mass composition-profile catalog (per organization). */
export type MassCompositionProfileDto = MassCompositionProfile;

export type MassCompositionProfilesData = MassCompositionProfilesResponse;

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
  create(input: StandardWriteInput): Promise<StandardRecord>;
  /** The stored row: no validity verdict (`isExpired`) or certificate document. */
  update(
    id: string | number,
    input: StandardWriteInput,
  ): Promise<StandardRecord>;
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

// =============================================================================
// CUSTOMERS: the DTOs are the contract schemas' types
// (`@calibra-facil/contracts`, `endpoints/customers.ts`); the client itself is
// generated from the endpoint definitions (`modules/customers.ts`).
// =============================================================================

export type { CnpjLookupResult };
export type CustomersListData = CustomersListResponse;
export type CustomerDetailData = CustomerDetail;
export type { CustomersApi };

// =============================================================================
// CUSTOMER GROUPS (multi-unit client networks)
// =============================================================================

type CustomerGroupListItem = {
  id: number;
  name: string;
  authOrganizationId: string;
  createdAt: string | Date;
  branchCount: number;
};

export type CustomerGroupsListData = { data: Array<CustomerGroupListItem> };

type CustomerGroupBranch = {
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

// ASSETS: the DTOs are the contract schemas' types (`endpoints/assets.ts`);
// the client is generated from the endpoint definitions (`modules/assets.ts`).
export type { AssetStatus };
export type AssetsListData = AssetsListResponse;
export type AssetDetailData = AssetDetail;
export type { AssetAuditLogEntry, AssetsApi };

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

export type { EnvironmentalLimitsApi };

/** Accredited-scope (CMC) line: ISO/IEC 17025 7.6/7.8.3, ILAC P14 (#427). */
export type AccreditedScopeLine = ContractAccreditedScopeLine;
export type ScopeEnforcementMode = ContractScopeEnforcementMode;
export type AccreditedScopeResponse = ContractAccreditedScopeResponse;
export type SaveAccreditedScopeLineInput = z.input<
  typeof AccreditedScopeLineSchema
>;
export type SaveAccreditedScopeLineResponse =
  ContractSaveAccreditedScopeLineResponse;
export type { AccreditedScopeApi };

// REPORTS: the DTOs and the client are the endpoint definitions' own
// (`endpoints/reports.ts`, `modules/reports.ts`).
export type { ReportsApi };

export interface PublicSignupApi {
  start<TInput = unknown>(input: TInput): Promise<SelfServeSignupResponse>;
}

// Non-conformances and CAPA: the clients are generated from the endpoint
// definitions (`modules/`); their DTOs are the contract's.
export type { CapasApi, NonConformancesApi };

export type { ProficiencyTestsApi };

export type { SpcApi };

export type { CompetencesApi, TrainingRecordsApi };

// CALIBRATION REQUESTS and ON-SITE VISITS: the DTOs and the clients are the
// endpoint definitions' own (`endpoints/calibration-requests.ts`,
// `endpoints/visits.ts`; `modules/calibration-requests.ts`, `modules/visits.ts`).
export type { CalibrationRequestsApi, VisitsApi };

export interface IntegrationsApi {
  list<TResponse = unknown>(): Promise<TResponse>;
  create<TResponse = unknown>(input: unknown): Promise<TResponse>;
  startContaAzulOAuth<TResponse = unknown>(input: unknown): Promise<TResponse>;
  getContaAzulApp<TResponse = unknown>(): Promise<TResponse>;
  saveContaAzulApp<TResponse = unknown>(input: unknown): Promise<TResponse>;
  removeContaAzulApp<TResponse = unknown>(): Promise<TResponse>;
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

// =============================================================================
// SERVICE ORDERS: the DTOs are the contract schemas' types
// (`@calibra-facil/contracts`, `endpoints/service-orders.ts`); the client is
// generated from the endpoint definitions (`modules/service-orders.ts`).
// =============================================================================

export type CreateServiceOrderInput = z.input<typeof CreateServiceOrderSchema>;
export type ServiceOrdersListData = ServiceOrdersListResponse;
export type {
  ServiceOrderCommunicationStatus,
  ServiceOrderDetail,
  ServiceOrdersApi,
};

// =============================================================================
// DASHBOARD: the DTOs are the contract schemas' types
// (`@calibra-facil/contracts`, `endpoints/dashboard.ts`); the client itself is
// generated from the endpoint definitions (`modules/dashboard.ts`).
// =============================================================================

export type DashboardJobStatus = JobStatus;
export type { DashboardJob, DashboardStats };
export type { DashboardApi };

type DashboardUnitSummary = {
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

export type FinanceAccessResponse = {
  canReadFinancial: boolean;
  canManageFinancial: boolean;
  canExportFinancial: boolean;
  role: string;
};

/** One step of the first-certificate checklist, derived server-side. */
export type ActivationStepId =
  | "organizationProfile"
  | "methodPublished"
  | "referenceStandard"
  | "signingCertificate"
  | "customer"
  | "firstCertificate";

export type ActivationChecklistResponse = {
  steps: Array<{ id: ActivationStepId; done: boolean }>;
  complete: boolean;
};

export interface OnboardingApi {
  /** What the laboratory still has to do before its first certificate. */
  getChecklist(): Promise<ActivationChecklistResponse>;
}

export interface AccessApi {
  getFinanceAccess(): Promise<FinanceAccessResponse>;
}

// FINANCE: the client is generated from the endpoint definitions
// (`modules/finance.ts`); its DTOs are the contract's.
export type { FinanceApi };

export interface SessionsApi {
  revoke(sessionId: string): Promise<unknown>;
}

export type SelfServeSignupResponse = {
  ok: true;
  email?: string;
  /** False when the account exists but the setup e-mail could not be sent. */
  emailDelivered?: boolean;
  error?: string;
  code?: string;
};

// SSO: the DTOs are the contract schemas' types (`endpoints/sso.ts`); the client
// is generated from the endpoint definitions (`modules/sso.ts`).
export type { SsoApi, SsoSettingsResponse, SsoVerificationRecord };

type ApiKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | Date | null;
  /** After this instant the key no longer works (null: a key made before expiry existed). */
  expiresAt: string | Date | null;
  /** Client addresses or CIDR ranges the key is accepted from (null: any). */
  allowedIps: string[] | null;
  createdAt: string | Date;
  revokedAt: string | Date | null;
};

export type ApiKeysListResponse = {
  data: ApiKeySummary[];
};

export type CreateApiKeyInput = {
  name: string;
  scopes?: string[];
  /** 1 to 730; default 365. */
  expiresInDays?: number;
  allowedIps?: string[];
};

export type ApiKeySecretResponse = {
  secret: string;
  key: Pick<
    ApiKeySummary,
    "id" | "name" | "keyPrefix" | "scopes" | "expiresAt" | "allowedIps"
  >;
};

export interface ApiKeysApi {
  list(): Promise<ApiKeysListResponse>;
  create(input: CreateApiKeyInput): Promise<ApiKeySecretResponse>;
  rotate(id: string): Promise<ApiKeySecretResponse>;
  revoke(id: string): Promise<{ success: boolean }>;
}

export type SoftDeleteOrganizationResponse = {
  success: boolean;
  deletedAt: string;
};

/**
 * Organization lifecycle (records retention). The laboratory's owner
 * soft-deletes it: its records are kept for the retention period and the
 * laboratory is locked. Cloud only.
 */
export interface OrganizationLifecycleApi {
  softDelete(
    input: SoftDeleteOrganizationRequest,
  ): Promise<SoftDeleteOrganizationResponse>;
}

/** The laboratory profile as `PATCH /api/organization/profile` answers it. */
export type OrganizationProfileResponse = {
  cnpj: string | null;
  accreditationNumber: string | null;
  accreditationBody: string | null;
  accreditationActive: boolean;
  accreditationValidFrom: string | null;
  accreditationValidUntil: string | null;
  permissionariaAuthorizationNumber: string | null;
  permissionariaAuthorizationState: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  technicalManagerName: string | null;
  technicalManagerTitle: string | null;
};

/**
 * The laboratory profile: CNPJ, accreditation claim, address, contacts and the
 * technical manager. Written only here (Better Auth's `organization.update` no
 * longer accepts these fields). Admin or owner; cloud only.
 */
export interface OrganizationProfileApi {
  update(
    input: UpdateOrganizationProfileRequest,
  ): Promise<OrganizationProfileResponse>;
}

export interface EntityLabelsApi {
  getNonConformance(id: string | number): Promise<string | null>;
  getCapa(id: string | number): Promise<string | null>;
  getCompetence(id: string | number): Promise<string | null>;
}

// CERTIFICATE NUMBERING: the DTOs are the contract schemas' types
// (`endpoints/certificate-numbering.ts`); the client is generated from the
// endpoint definitions (`modules/certificate-numbering.ts`).
export type CertificateNumberingResetScope =
  CertificateNumberingConfig["sequence"]["resetScope"];
export type {
  CertificateNumberingApi,
  CertificateNumberingConfig,
  CertificateNumberingProfileResponse,
  UpdateCertificateNumberingProfileResponse,
};

// PORTAL DOMAINS: the DTOs are the contract schemas' types
// (`endpoints/portal-domains.ts`); the client is generated from the endpoint
// definitions (`modules/portal-domains.ts`).
export type { PortalDomainResponse, PortalDomainsApi };

type EmailDomainStatus =
  | "not_configured"
  | "waiting_verification"
  | "verified"
  | "active";

type EmailDomainKeyStatus = "ok" | "invalid" | "rate_limited";

type EmailDomainRecord = {
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

export interface EmailDomainsApi {
  get(): Promise<EmailDomainResponse>;
  /**
   * Creates the sending domain in our own provider account and returns the DNS
   * records for the laboratory to publish. No API key is ever supplied by the
   * client: the laboratory does not have one and never needs one.
   */
  create(input: {
    hostname: string;
    fromLocalPart: string;
  }): Promise<EmailDomainResponse>;
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

type NotificationPreference = {
  inApp: boolean;
  email: boolean;
};

type NotificationPreferencesMap = Record<string, NotificationPreference>;

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
    status?: "UNREAD";
  }): Promise<NotificationsListResponse>;
  markRead(notificationIds: number[]): Promise<unknown>;
  markAllRead(): Promise<unknown>;
  getPreferences(): Promise<NotificationPreferencesResponse>;
  updatePreferences(
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferencesResponse>;
}

// SIGNATURES: the DTOs are the contract schemas' types
// (`endpoints/signatures.ts`); the client is generated from the endpoint
// definitions plus the multipart upload (`modules/signatures.ts`).
export type { MySignatureResponse, SignatureUploadResponse, SignaturesApi };

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

export interface OrganizationMediaApi {
  uploadLogo(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<OrganizationLogoUploadResponse>;
  deleteLogo(): Promise<OrganizationLogoDeleteResponse>;
}

// SIGNING CERTIFICATES: the DTOs are the contract schemas' types
// (`endpoints/signing-certificates.ts`); the client is generated from the
// endpoint definitions (`modules/signing-certificates.ts`).
export type {
  SigningCertificate,
  SigningCertificatesApi,
  SigningCertificatesListResponse,
  UnsignedIssuanceSetting,
};

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
  onboarding: OnboardingApi;
  sessions: SessionsApi;
  finance: FinanceApi;
  sso: SsoApi;
  apiKeys: ApiKeysApi;
  organizationLifecycle: OrganizationLifecycleApi;
  organizationProfile: OrganizationProfileApi;
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
  publicInvitations: PublicInvitationsApi;
  publicSignup: PublicSignupApi;
  labSetup: LabSetupApi;
  nonConformances: NonConformancesApi;
  capas: CapasApi;
  proficiencyTests: ProficiencyTestsApi;
  spc: SpcApi;
  competences: CompetencesApi;
  trainingRecords: TrainingRecordsApi;
  calibrationRequests: CalibrationRequestsApi;
  visits: VisitsApi;
  integrations: IntegrationsApi;
}
