import { hc } from "hono/client";
import type { Hono } from "hono";
import type {
  CalibraBridge,
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
  ServiceOrderDetail,
  ServiceOrderDocumentUrl,
  ServiceOrderRepairSealInput,
  ServiceOrdersListData,
  ServiceOrdersListInput,
} from "./service-orders";
import { getDesktopDataPolicyUnavailableMessage } from "./data-policy";

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
  ServiceOrderDetail,
  ServiceOrderDocumentUrl,
  ServiceOrderListItem,
  ServiceOrderRepairSealInput,
  ServiceOrdersListData,
  ServiceOrdersListInput,
  ServiceOrderStatus,
} from "./service-orders";
export * from "./data-policy";

export type HonoCloudClient<
  TApp extends Hono<any, any, any> = Hono<any, any, any>,
> = ReturnType<typeof hc<TApp>>;

export type ActiveUnitProvider = () => string | null;

export type CreateCloudApiClientOptions = {
  baseUrl: string;
  activeUnitProvider?: ActiveUnitProvider;
  fetch?: typeof fetch;
};

export type CreateDesktopApiClientOptions = {
  baseUrl: string;
  tokenProvider?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
};

export type CreateDesktopHybridApiClientOptions = {
  cloud: CreateCloudApiClientOptions;
  local: CreateDesktopApiClientOptions;
};

export type JobsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  query?: string;
  status?: JobsListStatus;
};

export type CreateJobInput = {
  assetId: number;
  serviceId: number;
  technicianId?: string | null;
  dueDate?: string | null;
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
    input: { reason: string; environmentalJustification?: string },
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
  amend(jobId: string | number, reason: string): Promise<JobAmendResult>;
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

export type CreateServiceInput = {
  name: string;
  description?: string | null;
  methodId?: number | null;
  assetTypeId?: number | null;
  price?: number | null;
  currency?: string;
  tat?: number | null;
  isActive?: boolean;
};

export type UpdateServiceInput = Partial<CreateServiceInput>;

export type ServiceAuditLogData<TRecord = unknown> = {
  data: TRecord[];
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
    validations: unknown[];
    uncertaintyParams?: unknown[];
    certificateContent?: unknown;
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

export type MethodWriteInput = Record<string, unknown>;

export type MethodAuditLogData<TRecord = unknown> = {
  data: TRecord[];
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
}

export type StandardStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "OUT_OF_TOLERANCE"
  | "SENT_FOR_CALIBRATION";

export type CertifiedValue = {
  nominal: string;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
};

export type StandardData = {
  id: number;
  name: string;
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

export interface StandardsApi {
  list(input?: StandardsListInput): Promise<StandardsListData>;
  get(id: string | number): Promise<StandardData>;
  auditLog<TRecord = unknown>(
    id: string | number,
  ): Promise<StandardAuditLogData<TRecord>>;
  create(input: StandardWriteInput): Promise<{ id: number }>;
  update(id: string | number, input: StandardWriteInput): Promise<StandardData>;
  delete(id: string | number): Promise<unknown>;
  renew(id: string | number, input: StandardWriteInput): Promise<unknown>;
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
    taxId: string | null;
    email: string | null;
    phone?: string | null;
    authOrganizationId: string | null;
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

export type CreateCustomerInput = {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: {
    cep?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighbourhood?: string;
    city?: string;
    state?: string;
  };
};

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

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
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
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

export interface CustomersApi {
  list(input: CustomersListInput): Promise<CustomersListData>;
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

export type AssetsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  status?: string;
  query?: string;
};

export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

export type CreateAssetInput = {
  customerId: number;
  assetTypeId: number;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber: string;
  tag: string;
  status?: AssetStatus;
  baseMeasurementUnit?: "mg" | "g" | "kg" | null;
  lastCalibrationDate?: string;
  nextCalibrationDate?: string;
  comments?: string;
  specifications?: Record<string, unknown>;
};

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
  comments?: string | null;
  specifications?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type UpdateAssetInput = Partial<
  Omit<CreateAssetInput, "customerId" | "assetTypeId" | "baseMeasurementUnit">
>;

export type AssetAuditLogData<TRecord = unknown> = {
  data: TRecord[];
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

export interface IntegrationsApi {
  list<TResponse = unknown>(): Promise<TResponse>;
  create<TResponse = unknown>(input: unknown): Promise<TResponse>;
  validate<TResponse = unknown>(id: string): Promise<TResponse>;
  update<TResponse = unknown>(id: string, input: unknown): Promise<TResponse>;
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
  retryRun<TResponse = unknown>(id: string, runId: string): Promise<TResponse>;
}

export interface ServiceOrdersApi {
  list(input: ServiceOrdersListInput): Promise<ServiceOrdersListData>;
  get(id: string | number): Promise<ServiceOrderDetail>;
  create(input: CreateServiceOrderInput): Promise<CreateServiceOrderResult>;
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
  updateRepairSeal(
    id: string | number,
    input: ServiceOrderRepairSealInput,
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
  hasCustomIntegrations: boolean;
  canReadFinancial: boolean;
  canManageFinancial: boolean;
  canExportFinancial: boolean;
  role: string;
};

export interface AccessApi {
  getPlanAccess(): Promise<PlanAccessResponse>;
  getFinanceAccess(): Promise<FinanceAccessResponse>;
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

export interface BackofficeApi {
  getAccess(): Promise<BackofficeAccessResponse>;
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

export type UpdateCertificateNumberingProfileInput = {
  name: string;
  config: CertificateNumberingConfig;
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

export type UpdateNotificationPreferencesInput = {
  preferences?: NotificationPreferencesMap;
  emailEnabled?: boolean;
  notifySelfActions?: boolean;
  digestFrequency?: "NONE" | "DAILY" | "WEEKLY";
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
}

export interface CalibraApi {
  dashboard: DashboardApi;
  units: UnitsApi;
  access: AccessApi;
  sessions: SessionsApi;
  billing: BillingApi;
  backoffice: BackofficeApi;
  sso: SsoApi;
  apiKeys: ApiKeysApi;
  entityLabels: EntityLabelsApi;
  certificateNumbering: CertificateNumberingApi;
  portalDomains: PortalDomainsApi;
  notifications: NotificationsApi;
  signatures: SignaturesApi;
  profileMedia: ProfileMediaApi;
  signingCertificates: SigningCertificatesApi;
  customers: CustomersApi;
  assets: AssetsApi;
  assetTypes: AssetTypesApi;
  services: ServicesApi;
  methods: MethodsApi;
  standards: StandardsApi;
  jobs: JobsApi;
  serviceOrders: ServiceOrdersApi;
  sync: SyncApi;
  attachments: AttachmentsApi;
  environmentalLimits: EnvironmentalLimitsApi;
  integrations: IntegrationsApi;
}

export function createRawCloudClient<
  TApp extends Hono<any, any, any> = Hono<any, any, any>,
>(options: CreateCloudApiClientOptions): HonoCloudClient<TApp> {
  const fetchImpl = options.fetch ?? fetch;

  return hc<TApp>(options.baseUrl, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const activeUnitId = options.activeUnitProvider?.();

      if (activeUnitId) {
        headers.set("x-active-unit-id", activeUnitId);
      }

      return fetchImpl(input, {
        ...init,
        credentials: "include",
        headers,
      });
    },
  });
}

export function createCloudApiClient(
  options: CreateCloudApiClientOptions,
): CalibraApi {
  const api = createRawCloudClient(options) as unknown as {
    api: {
      dashboard: {
        stats: {
          $get(): Promise<Response>;
        };
      };
      billing: {
        access: {
          $get(): Promise<Response>;
        };
        subscription: {
          $get(): Promise<Response>;
        };
        payments: {
          $get(input: {
            query: {
              limit?: string;
              offset?: string;
            };
          }): Promise<Response>;
        };
      };
      finance: {
        access: {
          $get(): Promise<Response>;
        };
      };
      sessions: {
        revoke: {
          $post(input: { json: { sessionId: string } }): Promise<Response>;
        };
      };
      backoffice: {
        access: {
          $get(): Promise<Response>;
        };
        impersonation: {
          stop: {
            $post(): Promise<Response>;
          };
        };
      };
      sso: {
        start: {
          $post(input: { json: StartSsoInput }): Promise<Response>;
        };
        providers: {
          $get(): Promise<Response>;
          $post(input: { json: CreateSsoProviderInput }): Promise<Response>;
          ":providerId": {
            $delete(input: {
              param: { providerId: string };
            }): Promise<Response>;
            "request-domain-verification": {
              $post(input: {
                param: { providerId: string };
              }): Promise<Response>;
            };
            "verify-domain": {
              $post(input: {
                param: { providerId: string };
              }): Promise<Response>;
            };
          };
        };
      };
      "api-keys": {
        $get(): Promise<Response>;
        $post(input: { json: CreateApiKeyInput }): Promise<Response>;
        ":id": {
          rotate: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          revoke: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      nc: {
        ":id": {
          label: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      capa: {
        ":id": {
          label: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      competences: {
        ":id": {
          label: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      "certificate-numbering": {
        $get(): Promise<Response>;
        $put(input: {
          json: UpdateCertificateNumberingProfileInput;
        }): Promise<Response>;
      };
      "portal-domains": {
        $get(): Promise<Response>;
        $post(input: { json: { hostname: string } }): Promise<Response>;
        $delete(): Promise<Response>;
        verify: {
          $post(): Promise<Response>;
        };
        activate: {
          $post(): Promise<Response>;
        };
      };
      integrations: {
        $get(): Promise<Response>;
        $post(input: { json: unknown }): Promise<Response>;
        ":id": {
          $put(input: {
            param: { id: string };
            json: unknown;
          }): Promise<Response>;
          validate: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          toggle: {
            $post(input: {
              param: { id: string };
              json: { enabled: boolean };
            }): Promise<Response>;
          };
          sync: {
            $post(input: {
              param: { id: string };
              json: unknown;
            }): Promise<Response>;
            preview: {
              $post(input: {
                param: { id: string };
                json: unknown;
              }): Promise<Response>;
            };
          };
          schedule: {
            $post(input: {
              param: { id: string };
              json: unknown;
            }): Promise<Response>;
          };
          runs: {
            ":runId": {
              retry: {
                $post(input: {
                  param: { id: string; runId: string };
                }): Promise<Response>;
              };
            };
          };
        };
      };
      notifications: {
        $get(input: {
          query: {
            page: string;
            limit: string;
          };
        }): Promise<Response>;
        "unread-count": {
          $get(): Promise<Response>;
        };
        "mark-read": {
          $post(input: {
            json: { notificationIds: number[] };
          }): Promise<Response>;
        };
        "mark-all-read": {
          $post(): Promise<Response>;
        };
        preferences: {
          $get(): Promise<Response>;
          $put(input: {
            json: UpdateNotificationPreferencesInput;
          }): Promise<Response>;
        };
      };
      signatures: {
        "my-signature": {
          $get(): Promise<Response>;
          $delete(): Promise<Response>;
        };
      };
      signing: {
        certificates: {
          $get(): Promise<Response>;
          $post(input: {
            json: UploadSigningCertificateInput;
          }): Promise<Response>;
          ":id": {
            $delete(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
            "set-default": {
              $post(input: { param: { id: string } }): Promise<Response>;
            };
          };
        };
      };
      units: {
        $get(): Promise<Response>;
        admin: {
          units: {
            $get(): Promise<Response>;
            $post(input: { json: { name: string } }): Promise<Response>;
            ":id": {
              $patch(input: {
                param: { id: string };
                json: { name?: string; status?: "ACTIVE" | "ARCHIVED" };
              }): Promise<Response>;
            };
          };
          members: {
            $get(): Promise<Response>;
            ":memberId": {
              assignments: {
                $put(input: {
                  param: { memberId: string };
                  json: {
                    assignments: Array<{
                      unitId: number;
                      role: "member" | "technician" | "unit_admin";
                    }>;
                  };
                }): Promise<Response>;
              };
              role: {
                $patch(input: {
                  param: { memberId: string };
                  json: { role: string };
                }): Promise<Response>;
              };
            };
          };
          activity: {
            $get(): Promise<Response>;
          };
        };
      };
      jobs: {
        $post(input: { json: CreateJobInput }): Promise<Response>;
        $get(input: {
          query: {
            page: string;
            limit: string;
            customerId?: string;
            query?: string;
            status?: JobsListStatus;
          };
        }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $delete(input: {
            param: { id: string };
            json: { reason: string };
          }): Promise<Response>;
          approve: {
            $post(input: {
              param: { id: string };
              json: { reason: string; environmentalJustification?: string };
            }): Promise<Response>;
          };
          reject: {
            $post(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
          };
          assign: {
            $post(input: {
              param: { id: string };
              json: { technicianId: string };
            }): Promise<Response>;
          };
          download: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          "generate-label": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "download-label": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          amend: {
            $post(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
          };
          execute: {
            $post(input: {
              param: { id: string };
              json: JobExecutionPayload;
            }): Promise<Response>;
          };
          submit: {
            $post(input: {
              param: { id: string };
              json: JobExecutionPayload;
            }): Promise<Response>;
          };
        };
        technicians: {
          list: {
            $get(): Promise<Response>;
          };
        };
      };
      services: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            query?: string;
            assetTypeId?: string;
            methodId?: string;
            isActive?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateServiceInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: UpdateServiceInput;
          }): Promise<Response>;
          $delete(input: { param: { id: string } }): Promise<Response>;
          "audit-log": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      methods: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            status?: string;
            assetTypeId?: string;
            query?: string;
            includeArchived?: string;
          };
        }): Promise<Response>;
        $post(input: { json: MethodWriteInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: MethodWriteInput;
          }): Promise<Response>;
          audit: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          archive: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "new-version": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "technical-review": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "quality-approve": {
            $post(input: {
              param: { id: string };
              json: MethodWriteInput;
            }): Promise<Response>;
          };
          "return-to-draft": {
            $post(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
          };
        };
      };
      standards: {
        $get(input: {
          query: {
            page?: string;
            status?: string;
            query?: string;
            limit?: string;
          };
        }): Promise<Response>;
        $post(input: { json: StandardWriteInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: StandardWriteInput;
          }): Promise<Response>;
          $delete(input: { param: { id: string } }): Promise<Response>;
          "audit-log": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          renew: {
            $post(input: {
              param: { id: string };
              json: StandardWriteInput;
            }): Promise<Response>;
          };
        };
      };
      "environmental-limits": {
        $get(): Promise<Response>;
        $put(input: { json: SaveEnvironmentalLimitInput }): Promise<Response>;
        ":id": {
          $delete(input: { param: { id: string } }): Promise<Response>;
        };
        effective: {
          ":assetTypeId": {
            $get(input: {
              param: { assetTypeId: string };
              query?: { unitId?: string };
            }): Promise<Response>;
          };
        };
      };
      customers: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            query?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateCustomerInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: UpdateCustomerInput;
          }): Promise<Response>;
          "audit-log": {
            $get(input: {
              param: { id: string };
              query: { page: string; limit: string };
            }): Promise<Response>;
          };
          compliance: {
            $put(input: {
              param: { id: string };
              json: UpdateCustomerComplianceInput;
            }): Promise<Response>;
          };
          members: {
            $get(input: { param: { id: string } }): Promise<Response>;
            ":memberId": {
              $delete(input: {
                param: { id: string; memberId: string };
              }): Promise<Response>;
            };
          };
          invitations: {
            $get(input: { param: { id: string } }): Promise<Response>;
            $post(input: {
              param: { id: string };
              json: { email: string; role: string };
            }): Promise<Response>;
            ":invId": {
              $delete(input: {
                param: { id: string; invId: string };
              }): Promise<Response>;
              resend: {
                $post(input: {
                  param: { id: string; invId: string };
                }): Promise<Response>;
              };
            };
          };
        };
      };
      assets: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            customerId?: string;
            status?: string;
            query?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateAssetInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: UpdateAssetInput;
          }): Promise<Response>;
          "audit-log": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      "asset-types": {
        $get(input: { query?: Record<string, string> }): Promise<Response>;
      };
      "service-orders": {
        $get(input: {
          query: {
            page: string;
            limit: string;
            query?: string;
            status?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateServiceOrderInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          evaluations: {
            $post(input: {
              param: { id: string };
              json: SaveServiceOrderEvaluationInput;
            }): Promise<Response>;
            ":evaluationId": {
              $patch(input: {
                param: { id: string; evaluationId: string };
                json: SaveServiceOrderEvaluationInput;
              }): Promise<Response>;
            };
          };
          quotes: {
            $post(input: {
              param: { id: string };
              json: CreateServiceOrderQuoteInput;
            }): Promise<Response>;
            ":quoteId": {
              send: {
                $post(input: {
                  param: { id: string; quoteId: string };
                  json: SendServiceOrderQuoteInput;
                }): Promise<Response>;
              };
            };
          };
          execution: {
            finish: {
              $post(input: {
                param: { id: string };
                json: SaveServiceOrderExecutionInput;
              }): Promise<Response>;
            };
          };
          "intake-document": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "intake-document.pdf": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          tag: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "tag.pdf": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          "repair-seal": {
            $patch(input: {
              param: { id: string };
              json: ServiceOrderRepairSealInput;
            }): Promise<Response>;
          };
          deliver: {
            $post(input: {
              param: { id: string };
              json: DeliverServiceOrderInput;
            }): Promise<Response>;
          };
          "delivery-document": {
            $post(input: {
              param: { id: string };
              json: IssueServiceOrderDeliveryDocumentInput;
            }): Promise<Response>;
          };
          "delivery-document.pdf": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
    };
  };

  return {
    dashboard: {
      async getStats<TStats = DashboardStats>() {
        const response = await api.api.dashboard.stats.$get();

        if (!response.ok) {
          throw new Error("Falha ao carregar estatísticas");
        }

        return response.json() as Promise<TStats>;
      },
    },
    units: {
      async getDashboardUnits() {
        const response = await api.api.units.$get();

        if (response.status === 403) {
          return null;
        }

        if (!response.ok) {
          throw new Error("Falha ao carregar unidades");
        }

        return response.json() as Promise<DashboardUnitsResponse>;
      },
      async listAdminUnits<TResponse = unknown>() {
        return readOptionalForbiddenResponse<TResponse>(
          await api.api.units.admin.units.$get(),
          emptyGovernanceResponse(),
          "Falha ao carregar unidades",
        );
      },
      async listAdminMembers<TResponse = unknown>() {
        return readOptionalForbiddenResponse<TResponse>(
          await api.api.units.admin.members.$get(),
          emptyGovernanceResponse(),
          "Falha ao carregar governança por unidade",
        );
      },
      async listAdminActivity<TResponse = unknown>() {
        return readOptionalForbiddenResponse<TResponse>(
          await api.api.units.admin.activity.$get(),
          emptyGovernanceResponse(),
          "Falha ao carregar atividade de governança",
        );
      },
      async createAdminUnit<TResponse = unknown>(name: string) {
        return readMutationResponse<TResponse>(
          await api.api.units.admin.units.$post({ json: { name } }),
          "Erro ao criar unidade",
        );
      },
      async updateAdminUnit<TResponse = unknown>(
        unitId: number,
        payload: { name?: string; status?: "ACTIVE" | "ARCHIVED" },
      ) {
        return readMutationResponse<TResponse>(
          await api.api.units.admin.units[":id"].$patch({
            param: { id: String(unitId) },
            json: payload,
          }),
          "Erro ao atualizar unidade",
        );
      },
      async updateMemberAssignments<TResponse = unknown>(
        memberId: string,
        assignments: Array<{
          unitId: number;
          role: "member" | "technician" | "unit_admin";
        }>,
      ) {
        return readMutationResponse<TResponse>(
          await api.api.units.admin.members[":memberId"].assignments.$put({
            param: { memberId },
            json: { assignments },
          }),
          "Erro ao atualizar atribuições",
        );
      },
      async updateMemberRole<TResponse = unknown>(
        memberId: string,
        role: string,
      ) {
        return readMutationResponse<TResponse>(
          await api.api.units.admin.members[":memberId"].role.$patch({
            param: { memberId },
            json: { role },
          }),
          "Erro ao atualizar papel global",
        );
      },
    },
    access: {
      async getPlanAccess() {
        const response = await api.api.billing.access.$get();

        if (!response.ok) {
          throw new Error("Erro ao carregar plano atual");
        }

        return response.json() as Promise<PlanAccessResponse>;
      },
      async getFinanceAccess() {
        const response = await api.api.finance.access.$get();

        if (!response.ok) {
          throw new Error("Erro ao carregar acesso financeiro");
        }

        return response.json() as Promise<FinanceAccessResponse>;
      },
    },
    sessions: {
      async revoke(sessionId) {
        return readMutationResponse(
          await api.api.sessions.revoke.$post({ json: { sessionId } }),
          "Falha ao encerrar sessao",
        );
      },
    },
    billing: {
      async getSubscription() {
        const response = await api.api.billing.subscription.$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao carregar assinatura"),
          );
        }

        return response.json() as Promise<BillingSubscriptionResponse>;
      },
      async listPayments(input = {}) {
        const response = await api.api.billing.payments.$get({
          query: {
            limit: input.limit === undefined ? undefined : String(input.limit),
            offset:
              input.offset === undefined ? undefined : String(input.offset),
          },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao carregar pagamentos"),
          );
        }

        return response.json() as Promise<BillingPaymentsResponse>;
      },
    },
    backoffice: {
      async getAccess() {
        const response = await api.api.backoffice.access.$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(
              response,
              "Falha ao validar acesso ao backoffice",
            ),
          );
        }

        return response.json() as Promise<BackofficeAccessResponse>;
      },
      async stopImpersonation() {
        const response = await api.api.backoffice.impersonation.stop.$post();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao parar impersonação"),
          );
        }

        return { ok: true };
      },
    },
    sso: {
      async start(input) {
        const response = await api.api.sso.start.$post({ json: input });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao iniciar login via SSO"),
          );
        }

        return response.json() as Promise<StartSsoResponse>;
      },
      async getProviders() {
        const response = await api.api.sso.providers.$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao carregar configuração SSO"),
          );
        }

        return response.json() as Promise<SsoSettingsResponse>;
      },
      async createProvider(input) {
        const response = await api.api.sso.providers.$post({ json: input });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao registrar provedor SSO"),
          );
        }

        return response.json() as Promise<CreateSsoProviderResponse>;
      },
      async requestDomainVerification(providerId) {
        const response = await api.api.sso.providers[":providerId"][
          "request-domain-verification"
        ].$post({
          param: { providerId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao gerar token DNS"),
          );
        }

        return response.json() as Promise<RequestSsoDomainVerificationResponse>;
      },
      async verifyDomain(providerId) {
        const response = await api.api.sso.providers[":providerId"][
          "verify-domain"
        ].$post({
          param: { providerId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao verificar domínio"),
          );
        }

        return response.json() as Promise<VerifySsoDomainResponse>;
      },
      async deleteProvider(providerId) {
        const response = await api.api.sso.providers[":providerId"].$delete({
          param: { providerId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao remover provedor SSO"),
          );
        }
      },
    },
    apiKeys: {
      async list() {
        const response = await api.api["api-keys"].$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao carregar API keys"),
          );
        }

        return response.json() as Promise<ApiKeysListResponse>;
      },
      async create(input) {
        const response = await api.api["api-keys"].$post({ json: input });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao criar API key"),
          );
        }

        return response.json() as Promise<ApiKeySecretResponse>;
      },
      async rotate(id) {
        const response = await api.api["api-keys"][":id"].rotate.$post({
          param: { id },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao rotacionar API key"),
          );
        }

        return response.json() as Promise<ApiKeySecretResponse>;
      },
      async revoke(id) {
        const response = await api.api["api-keys"][":id"].revoke.$post({
          param: { id },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao revogar API key"),
          );
        }

        return response.json() as Promise<{ success: boolean }>;
      },
    },
    entityLabels: {
      async getNonConformance(id) {
        return parseCloudEntityLabel(
          await api.api.nc[":id"].label.$get({
            param: { id: String(id) },
          }),
          "non-conformance",
        );
      },
      async getCapa(id) {
        return parseCloudEntityLabel(
          await api.api.capa[":id"].label.$get({
            param: { id: String(id) },
          }),
          "capa",
        );
      },
      async getCompetence(id) {
        return parseCloudEntityLabel(
          await api.api.competences[":id"].label.$get({
            param: { id: String(id) },
          }),
          "competence",
        );
      },
    },
    certificateNumbering: {
      async getProfile() {
        const response = await api.api["certificate-numbering"].$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(
              response,
              "Falha ao carregar perfil de numeração",
            ),
          );
        }

        return response.json() as Promise<CertificateNumberingProfileResponse>;
      },
      async updateProfile(input) {
        const response = await api.api["certificate-numbering"].$put({
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao salvar perfil"),
          );
        }

        return response.json() as Promise<UpdateCertificateNumberingProfileResponse>;
      },
    },
    portalDomains: {
      async get() {
        const response = await api.api["portal-domains"].$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao carregar domínio do portal"),
          );
        }

        return response.json() as Promise<PortalDomainResponse>;
      },
      async create(input) {
        const response = await api.api["portal-domains"].$post({
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao salvar domínio"),
          );
        }

        return response.json() as Promise<PortalDomainActionResponse>;
      },
      async verify() {
        const response = await api.api["portal-domains"].verify.$post();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao verificar domínio"),
          );
        }

        return response.json() as Promise<PortalDomainActionResponse>;
      },
      async activate() {
        const response = await api.api["portal-domains"].activate.$post();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao ativar domínio"),
          );
        }

        return response.json() as Promise<PortalDomainActionResponse>;
      },
      async delete() {
        const response = await api.api["portal-domains"].$delete();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao remover domínio"),
          );
        }
      },
    },
    notifications: {
      async getUnreadCount() {
        const response = await api.api.notifications["unread-count"].$get();

        if (!response.ok) {
          throw new Error("Failed to fetch unread count");
        }

        return response.json() as Promise<UnreadNotificationsResponse>;
      },
      async listRecent(input = {}) {
        const response = await api.api.notifications.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 5),
          },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch notifications");
        }

        return response.json() as Promise<NotificationsListResponse>;
      },
      async markRead(notificationIds) {
        const response = await api.api.notifications["mark-read"].$post({
          json: { notificationIds },
        });

        if (!response.ok) {
          throw new Error("Failed to mark as read");
        }

        return response.json();
      },
      async markAllRead() {
        const response = await api.api.notifications["mark-all-read"].$post();

        if (!response.ok) {
          throw new Error("Failed to mark all as read");
        }

        return response.json();
      },
      async getPreferences() {
        const response = await api.api.notifications.preferences.$get();

        if (!response.ok) {
          throw new Error("Failed to fetch preferences");
        }

        return response.json() as Promise<NotificationPreferencesResponse>;
      },
      async updatePreferences(input) {
        const response = await api.api.notifications.preferences.$put({
          json: input,
        });

        if (!response.ok) {
          throw new Error("Failed to update preferences");
        }

        return response.json() as Promise<NotificationPreferencesResponse>;
      },
    },
    signatures: {
      async getMine() {
        const response = await api.api.signatures["my-signature"].$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Failed to fetch signature"),
          );
        }

        return response.json() as Promise<MySignatureResponse>;
      },
      async uploadMine(file, input) {
        const formData = new FormData();
        appendNamedBlob(formData, "signature", file, input?.fileName);

        const response = await (options.fetch ?? fetch)(
          new URL("/api/signatures/my-signature", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: createCloudHeaders(options.activeUnitProvider),
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Upload failed"));
        }

        return response.json() as Promise<SignatureUploadResponse>;
      },
      async deleteMine() {
        const response = await api.api.signatures["my-signature"].$delete();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Failed to delete signature"),
          );
        }

        return response.json() as Promise<SignatureDeleteResponse>;
      },
    },
    profileMedia: {
      async uploadAvatar(file, input) {
        const formData = new FormData();
        appendNamedBlob(formData, "avatar", file, input?.fileName);

        const response = await (options.fetch ?? fetch)(
          new URL("/api/profile-media/avatar", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: createCloudHeaders(options.activeUnitProvider),
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao enviar avatar"),
          );
        }

        return response.json() as Promise<ProfileAvatarUploadResponse>;
      },
      async deleteAvatar() {
        const response = await (options.fetch ?? fetch)(
          new URL("/api/profile-media/avatar", options.baseUrl),
          {
            method: "DELETE",
            credentials: "include",
            headers: createCloudHeaders(options.activeUnitProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao remover avatar"),
          );
        }

        return response.json() as Promise<ProfileAvatarDeleteResponse>;
      },
    },
    signingCertificates: {
      async list() {
        const response = await api.api.signing.certificates.$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Failed to fetch certificates"),
          );
        }

        return response.json() as Promise<SigningCertificatesListResponse>;
      },
      async upload(input) {
        const response = await api.api.signing.certificates.$post({
          json: input,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Upload failed"));
        }

        return response.json() as Promise<UploadSigningCertificateResponse>;
      },
      async setDefault(id) {
        const response = await api.api.signing.certificates[":id"][
          "set-default"
        ].$post({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Failed to set default"),
          );
        }

        return response.json() as Promise<SigningCertificateActionResponse>;
      },
      async revoke(id, reason) {
        const response = await api.api.signing.certificates[":id"].$delete({
          param: { id: String(id) },
          json: { reason },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Failed to revoke"));
        }

        return response.json() as Promise<SigningCertificateActionResponse>;
      },
    },
    customers: {
      async list(input) {
        const res = await api.api.customers.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
          },
        });

        if (!res.ok) {
          throw new Error("Falha ao carregar clientes");
        }

        return res.json() as Promise<CustomersListData>;
      },
      async create(input) {
        const response = await api.api.customers.$post({ json: input });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar cliente"),
          );
        }

        return response.json() as Promise<CustomersListData["data"][number]>;
      },
      async get<TCustomer = CustomerDetailData>(id: string | number) {
        const response = await api.api.customers[":id"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar cliente");
        }

        return response.json() as Promise<TCustomer>;
      },
      async update<TCustomer = CustomerDetailData>(
        id: string | number,
        input: UpdateCustomerInput,
      ) {
        const response = await api.api.customers[":id"].$put({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar cliente"),
          );
        }

        return response.json() as Promise<TCustomer>;
      },
      async auditLog<TRecord = unknown>(
        id: string | number,
        input: { page?: number; limit?: number } = {},
      ) {
        const response = await api.api.customers[":id"]["audit-log"].$get({
          param: { id: String(id) },
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 50),
          },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar historico");
        }

        return response.json() as Promise<CustomerAuditLogData<TRecord>>;
      },
      async updateCompliance<TCustomer = CustomerDetailData>(
        id: string | number,
        input: UpdateCustomerComplianceInput,
      ) {
        const response = await api.api.customers[":id"].compliance.$put({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar conformidade"),
          );
        }

        return response.json() as Promise<TCustomer>;
      },
      async listMembers<TMember = unknown>(id: string | number) {
        const response = await api.api.customers[":id"].members.$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar usuarios");
        }

        return response.json() as Promise<TMember[]>;
      },
      async listInvitations<TInvitation = unknown>(id: string | number) {
        const response = await api.api.customers[":id"].invitations.$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar convites");
        }

        return response.json() as Promise<TInvitation[]>;
      },
      async createInvitation<TInvitation = unknown>(
        id: string | number,
        input: { email: string; role: string },
      ) {
        const response = await api.api.customers[":id"].invitations.$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao enviar convite"),
          );
        }

        return response.json() as Promise<TInvitation>;
      },
      async resendInvitation(id: string | number, invitationId: string) {
        const response = await api.api.customers[":id"].invitations[
          ":invId"
        ].resend.$post({
          param: { id: String(id), invId: invitationId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao reenviar convite"),
          );
        }

        return response.json();
      },
      async cancelInvitation(id: string | number, invitationId: string) {
        const response = await api.api.customers[":id"].invitations[
          ":invId"
        ].$delete({
          param: { id: String(id), invId: invitationId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao cancelar convite"),
          );
        }

        return response.json();
      },
      async removeMember(id: string | number, memberId: string) {
        const response = await api.api.customers[":id"].members[
          ":memberId"
        ].$delete({
          param: { id: String(id), memberId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao remover usuário"),
          );
        }

        return response.json();
      },
    },
    assets: {
      async list(input) {
        const res = await api.api.assets.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            customerId: input.customerId ? String(input.customerId) : undefined,
            status: input.status || undefined,
            query: input.query || undefined,
          },
        });

        if (!res.ok) {
          throw new Error("Falha ao carregar ativos");
        }

        return res.json() as Promise<AssetsListData>;
      },
      async create(input) {
        const response = await api.api.assets.$post({ json: input });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar ativo"));
        }

        return response.json() as Promise<AssetsListData["data"][number]>;
      },
      async get<TAsset = AssetDetailData>(id: string | number) {
        const response = await api.api.assets[":id"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar ativo");
        }

        return response.json() as Promise<TAsset>;
      },
      async update<TAsset = AssetDetailData>(
        id: string | number,
        input: UpdateAssetInput,
      ) {
        const response = await api.api.assets[":id"].$put({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar ativo"),
          );
        }

        return response.json() as Promise<TAsset>;
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await api.api.assets[":id"]["audit-log"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<AssetAuditLogData<TRecord>>;
      },
    },
    assetTypes: {
      async list() {
        const res = await api.api["asset-types"].$get({ query: {} });

        if (!res.ok) {
          throw new Error("Falha ao carregar tipos de instrumento");
        }

        return res.json() as Promise<AssetTypesListData>;
      },
    },
    environmentalLimits: {
      async list() {
        const response = await api.api["environmental-limits"].$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao carregar limites"),
          );
        }

        return response.json() as Promise<EnvironmentalLimitsResponse>;
      },
      async save(input) {
        const response = await api.api["environmental-limits"].$put({
          json: input,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Falha ao salvar"));
        }

        return response.json() as Promise<SaveEnvironmentalLimitResponse>;
      },
      async delete(id) {
        const response = await api.api["environmental-limits"][":id"].$delete({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Falha ao remover"));
        }

        return response.json() as Promise<{ message: string }>;
      },
    },
    integrations: {
      async list<TResponse = unknown>() {
        const response = await api.api.integrations.$get();

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao carregar integrações"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async create<TResponse = unknown>(input: unknown) {
        const response = await api.api.integrations.$post({ json: input });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao criar integração"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async validate<TResponse = unknown>(id: string) {
        const response = await api.api.integrations[":id"].validate.$post({
          param: { id },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao validar conexão"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async update<TResponse = unknown>(id: string, input: unknown) {
        const response = await api.api.integrations[":id"].$put({
          param: { id },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao salvar mapeamento"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async toggle<TResponse = unknown>(
        id: string,
        input: { enabled: boolean },
      ) {
        const response = await api.api.integrations[":id"].toggle.$post({
          param: { id },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar status"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async previewSync<TResponse = unknown>(id: string, input: unknown) {
        const response = await api.api.integrations[":id"].sync.preview.$post({
          param: { id },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao montar prévia"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async sync<TResponse = unknown>(id: string, input: unknown) {
        const response = await api.api.integrations[":id"].sync.$post({
          param: { id },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao iniciar sync"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async schedule<TResponse = unknown>(id: string, input: unknown) {
        const response = await api.api.integrations[":id"].schedule.$post({
          param: { id },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar agenda"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
      async retryRun<TResponse = unknown>(id: string, runId: string) {
        const response = await api.api.integrations[":id"].runs[
          ":runId"
        ].retry.$post({
          param: { id, runId },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao reprocessar sync"),
          );
        }

        return response.json() as Promise<TResponse>;
      },
    },
    services: {
      async list(input = {}) {
        const res = await api.api.services.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            query: input.query || undefined,
            assetTypeId: input.assetTypeId
              ? String(input.assetTypeId)
              : undefined,
            methodId: input.methodId ? String(input.methodId) : undefined,
            isActive:
              input.isActive === undefined ? undefined : String(input.isActive),
          },
        });

        if (!res.ok) {
          throw new Error("Falha ao carregar serviços");
        }

        return res.json() as Promise<ServicesListData>;
      },
      async get(id) {
        const response = await api.api.services[":id"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar serviço");
        }

        return response.json() as Promise<ServiceDetailData>;
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await api.api.services[":id"]["audit-log"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<ServiceAuditLogData<TRecord>>;
      },
      async create(input) {
        const response = await api.api.services.$post({ json: input });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar serviço"),
          );
        }

        return response.json() as Promise<{ id: number }>;
      },
      async update(id, input) {
        const response = await api.api.services[":id"].$put({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar serviço"),
          );
        }

        return response.json() as Promise<ServiceDetailData>;
      },
      async deactivate(id) {
        const response = await api.api.services[":id"].$delete({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao desativar serviço"),
          );
        }

        return response.json() as Promise<unknown>;
      },
    },
    methods: {
      async list(input = {}) {
        const response = await api.api.methods.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            status: input.status || undefined,
            assetTypeId: input.assetTypeId
              ? String(input.assetTypeId)
              : undefined,
            query: input.query || undefined,
            includeArchived: input.status === "ARCHIVED" ? "true" : undefined,
          },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar métodos");
        }

        return response.json() as Promise<MethodsListData>;
      },
      async get(id) {
        const response = await api.api.methods[":id"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar método");
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async audit<TRecord = unknown>(id: string | number) {
        const response = await api.api.methods[":id"].audit.$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<MethodAuditLogData<TRecord>>;
      },
      async create(input) {
        const response = await api.api.methods.$post({ json: input });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar método"));
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async update(id, input) {
        const response = await api.api.methods[":id"].$put({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar método"),
          );
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async archive(id) {
        const response = await api.api.methods[":id"].archive.$post({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao arquivar método"),
          );
        }

        return response.json() as Promise<unknown>;
      },
      async createNewVersion(id) {
        const response = await api.api.methods[":id"]["new-version"].$post({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar nova versão"),
          );
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async technicalReview(id) {
        const response = await api.api.methods[":id"]["technical-review"].$post(
          {
            param: { id: String(id) },
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao revisar tecnicamente"),
          );
        }

        return response.json() as Promise<unknown>;
      },
      async qualityApprove(id, input = {}) {
        const response = await api.api.methods[":id"]["quality-approve"].$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao aprovar qualidade"),
          );
        }

        return response.json() as Promise<unknown>;
      },
      async returnToDraft(id, reason) {
        const response = await api.api.methods[":id"]["return-to-draft"].$post({
          param: { id: String(id) },
          json: { reason },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao retornar para rascunho"),
          );
        }

        return response.json() as Promise<unknown>;
      },
    },
    standards: {
      async list(input = {}) {
        const response = await api.api.standards.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            query: input.query || undefined,
            status: input.status || undefined,
          },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrões");
        }

        return response.json() as Promise<StandardsListData>;
      },
      async get(id) {
        const response = await api.api.standards[":id"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrão");
        }

        return response.json() as Promise<StandardData>;
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await api.api.standards[":id"]["audit-log"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<StandardAuditLogData<TRecord>>;
      },
      async create(input) {
        const response = await api.api.standards.$post({ json: input });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar padrão"));
        }

        return response.json() as Promise<{ id: number }>;
      },
      async update(id, input) {
        const response = await api.api.standards[":id"].$put({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar padrão"),
          );
        }

        return response.json() as Promise<StandardData>;
      },
      async delete(id) {
        const response = await api.api.standards[":id"].$delete({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao remover padrão"),
          );
        }

        return response.json() as Promise<unknown>;
      },
      async renew(id, input) {
        const response = await api.api.standards[":id"].renew.$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao renovar certificado"),
          );
        }

        return response.json() as Promise<unknown>;
      },
    },
    jobs: {
      async list(input) {
        const res = await api.api.jobs.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            customerId: input.customerId ? String(input.customerId) : undefined,
            query: input.query || undefined,
            status: input.status || undefined,
          },
        });

        if (!res.ok) {
          throw new Error("Falha ao carregar calibrações");
        }

        return res.json() as Promise<JobsListData>;
      },
      async create(input) {
        const response = await api.api.jobs.$post({ json: input });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar ordem"));
        }

        return response.json() as Promise<CreateJobResult>;
      },
      async get<TJob = unknown>(jobId: string | number) {
        const response = await api.api.jobs[":id"].$get({
          param: { id: String(jobId) },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar job");
        }

        return response.json() as Promise<TJob>;
      },
      async listTechnicians() {
        const response = await api.api.jobs.technicians.list.$get();

        if (!response.ok) {
          throw new Error("Falha ao carregar técnicos");
        }

        return response.json() as Promise<TechnicianListData>;
      },
      async approve(jobId, input) {
        const response = await api.api.jobs[":id"].approve.$post({
          param: { id: String(jobId) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao aprovar"));
        }

        return response.json();
      },
      async reject(jobId, reason) {
        const response = await api.api.jobs[":id"].reject.$post({
          param: { id: String(jobId) },
          json: { reason },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao rejeitar"));
        }

        return response.json();
      },
      async cancel(jobId, reason) {
        const response = await api.api.jobs[":id"].$delete({
          param: { id: String(jobId) },
          json: { reason },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao cancelar"));
        }

        return response.json();
      },
      async assign(jobId, technicianId) {
        const response = await api.api.jobs[":id"].assign.$post({
          param: { id: String(jobId) },
          json: { technicianId },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao atribuir"));
        }

        return response.json();
      },
      async listStandards<TStandard = unknown>() {
        const response = await api.api.standards.$get({
          query: { status: "ACTIVE", limit: "100" },
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrões");
        }

        return response.json() as Promise<
          ReferenceStandardsResponse<TStandard>
        >;
      },
      async getEffectiveEnvironmentalLimits<TLimits = unknown>(
        assetTypeId: string | number,
        input: { unitId?: string | number | null } = {},
      ) {
        const response = await api.api["environmental-limits"].effective[
          ":assetTypeId"
        ].$get({
          param: { assetTypeId: String(assetTypeId) },
          query: input.unitId ? { unitId: String(input.unitId) } : undefined,
        });

        if (!response.ok) {
          return { limits: null, source: null };
        }

        return response.json() as Promise<
          EffectiveEnvironmentalLimitsResponse<TLimits>
        >;
      },
      async saveExecution(jobId, input) {
        const response = await api.api.jobs[":id"].execute.$post({
          param: { id: String(jobId) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao salvar"));
        }

        return response.json();
      },
      async submitExecution(jobId, input) {
        const response = await api.api.jobs[":id"].submit.$post({
          param: { id: String(jobId) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao submeter"));
        }

        return response.json();
      },
      async createCertificateDraft() {
        throw new Error(
          "Rascunhos locais de certificado estão disponíveis apenas no desktop",
        );
      },
      async getCertificateDownloadUrl(jobId) {
        const response = await api.api.jobs[":id"].download.$get({
          param: { id: String(jobId) },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Falha ao gerar link"));
        }

        return response.json() as Promise<JobDownloadUrlData>;
      },
      async generateLabel(jobId) {
        const response = await api.api.jobs[":id"]["generate-label"].$post({
          param: { id: String(jobId) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao gerar etiqueta"),
          );
        }

        return response.json();
      },
      async getLabelDownloadUrl(jobId) {
        const response = await api.api.jobs[":id"]["download-label"].$get({
          param: { id: String(jobId) },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Falha ao gerar link"));
        }

        return response.json() as Promise<JobDownloadUrlData>;
      },
      async amend(jobId, reason) {
        const response = await api.api.jobs[":id"].amend.$post({
          param: { id: String(jobId) },
          json: { reason },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao criar retificação"),
          );
        }

        return response.json() as Promise<JobAmendResult>;
      },
    },
    serviceOrders: {
      async list(input) {
        const res = await api.api["service-orders"].$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
            status: input.status || undefined,
          },
        });

        if (!res.ok) {
          throw new Error("Erro ao carregar ordens de serviço");
        }

        return res.json() as Promise<ServiceOrdersListData>;
      },
      async get(id) {
        const response = await api.api["service-orders"][":id"].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error("Erro ao carregar OS");
        }

        const result = (await response.json()) as { data: ServiceOrderDetail };
        return result.data;
      },
      async create(input) {
        const response = await api.api["service-orders"].$post({
          json: input,
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar OS"));
        }

        return response.json() as Promise<CreateServiceOrderResult>;
      },
      async createQuote(id, input) {
        const response = await api.api["service-orders"][":id"].quotes.$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar orçamento"),
          );
        }

        return response.json();
      },
      async saveEvaluation(id, evaluationId, input) {
        const response = evaluationId
          ? await api.api["service-orders"][":id"].evaluations[
              ":evaluationId"
            ].$patch({
              param: { id: String(id), evaluationId: String(evaluationId) },
              json: input,
            })
          : await api.api["service-orders"][":id"].evaluations.$post({
              param: { id: String(id) },
              json: input,
            });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar avaliação"),
          );
        }

        return response.json();
      },
      async sendQuote(id, quoteId, input) {
        const response = await api.api["service-orders"][":id"].quotes[
          ":quoteId"
        ].send.$post({
          param: { id: String(id), quoteId: String(quoteId) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao emitir orçamento"),
          );
        }

        return response.json();
      },
      async saveExecution(id, input) {
        const response = await api.api["service-orders"][
          ":id"
        ].execution.finish.$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar execução"),
          );
        }

        return response.json();
      },
      async generateIntakeDocument(id) {
        const response = await api.api["service-orders"][":id"][
          "intake-document"
        ].$post({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao gerar comprovante"),
          );
        }

        return response.json();
      },
      async getIntakeDocumentPdf(id) {
        const response = await api.api["service-orders"][":id"][
          "intake-document.pdf"
        ].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "PDF ainda indisponível"),
          );
        }

        return response.json() as Promise<ServiceOrderDocumentUrl>;
      },
      async generateTag(id) {
        const response = await api.api["service-orders"][":id"].tag.$post({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao gerar etiqueta"),
          );
        }

        return response.json();
      },
      async getTagPdf(id) {
        const response = await api.api["service-orders"][":id"]["tag.pdf"].$get(
          {
            param: { id: String(id) },
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "PDF ainda indisponível"),
          );
        }

        return response.json() as Promise<ServiceOrderDocumentUrl>;
      },
      async updateRepairSeal(id, input) {
        const response = await api.api["service-orders"][":id"][
          "repair-seal"
        ].$patch({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar selo de reparado"),
          );
        }

        return response.json();
      },
      async deliver(id, input) {
        const response = await api.api["service-orders"][":id"].deliver.$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao registrar entrega"),
          );
        }

        return response.json();
      },
      async issueDeliveryDocument(id, input) {
        const response = await api.api["service-orders"][":id"][
          "delivery-document"
        ].$post({
          param: { id: String(id) },
          json: input,
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(
              response,
              "Erro ao gerar comprovante de entrega",
            ),
          );
        }

        return response.json();
      },
      async getDeliveryDocumentPdf(id) {
        const response = await api.api["service-orders"][":id"][
          "delivery-document.pdf"
        ].$get({
          param: { id: String(id) },
        });

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "PDF ainda indisponível"),
          );
        }

        return response.json() as Promise<ServiceOrderDocumentUrl>;
      },
    },
    sync: {
      async getSession() {
        return {
          data: null,
        };
      },
      async listConflicts() {
        return {
          data: [],
          total: 0,
        };
      },
      async resolveConflict() {
        throw new Error("Conflitos locais estão disponíveis apenas no desktop");
      },
    },
    attachments: {
      async list() {
        return { data: [] };
      },
      async upload() {
        throw new Error("Anexos locais estão disponíveis apenas no desktop");
      },
    },
  };
}

export function createDesktopApiClient(
  options: CreateDesktopApiClientOptions,
): CalibraApi {
  const fetchImpl = options.fetch ?? fetch;
  let localSessionCache: {
    expiresAt: number;
    promise: Promise<LocalSessionSnapshotResponse>;
  } | null = null;

  async function getLocalSessionSnapshot() {
    const now = Date.now();
    if (localSessionCache && localSessionCache.expiresAt > now) {
      return localSessionCache.promise;
    }

    const promise = (async () => {
      const response = await fetchImpl(
        new URL("/api/local/session", options.baseUrl),
        {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        },
      );

      return response;
    })()
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Falha ao carregar sessão local");
        }

        return response.json() as Promise<LocalSessionSnapshotResponse>;
      })
      .catch((error) => {
        localSessionCache = null;
        throw error;
      });

    localSessionCache = {
      expiresAt: now + 5_000,
      promise,
    };

    return promise;
  }

  return {
    dashboard: {
      async getStats<TStats = DashboardStats>() {
        const response = await fetchImpl(
          new URL("/api/dashboard/stats", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar estatísticas");
        }

        return response.json() as Promise<TStats>;
      },
    },
    units: {
      async getDashboardUnits() {
        const session = await getLocalSessionSnapshot();
        return buildDesktopUnitsResponse(session.data);
      },
      async listAdminUnits<TResponse = unknown>() {
        return emptyGovernanceResponse() as TResponse;
      },
      async listAdminMembers<TResponse = unknown>() {
        return emptyGovernanceResponse() as TResponse;
      },
      async listAdminActivity<TResponse = unknown>() {
        return emptyGovernanceResponse() as TResponse;
      },
      async createAdminUnit() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
      async updateAdminUnit() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
      async updateMemberAssignments() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
      async updateMemberRole() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
    },
    access: {
      async getPlanAccess() {
        return desktopPlanAccess();
      },
      async getFinanceAccess() {
        return desktopFinanceAccess();
      },
    },
    sessions: {
      async revoke() {
        throw desktopUnsupportedAuthAction("Gerenciamento de sessoes");
      },
    },
    billing: {
      async getSubscription() {
        return desktopBillingSubscription();
      },
      async listPayments() {
        return { data: [] };
      },
    },
    backoffice: {
      async getAccess() {
        return {
          allowed: false,
          roles: [],
          bootstrapAvailable: false,
          isImpersonating: false,
        };
      },
      async stopImpersonation() {
        throw desktopUnsupportedBackofficeAction("Impersonação backoffice");
      },
    },
    sso: {
      async start() {
        throw desktopUnsupportedAuthAction("Login SSO");
      },
      async getProviders() {
        return desktopSsoSettings();
      },
      async createProvider() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
      async requestDomainVerification() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
      async verifyDomain() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
      async deleteProvider() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
    },
    apiKeys: {
      async list() {
        return { data: [] };
      },
      async create() {
        throw desktopUnsupportedAuthAction("API keys");
      },
      async rotate() {
        throw desktopUnsupportedAuthAction("API keys");
      },
      async revoke() {
        throw desktopUnsupportedAuthAction("API keys");
      },
    },
    entityLabels: {
      async getNonConformance() {
        return null;
      },
      async getCapa() {
        return null;
      },
      async getCompetence() {
        return null;
      },
    },
    certificateNumbering: {
      async getProfile() {
        return desktopCertificateNumberingProfile();
      },
      async updateProfile() {
        throw desktopUnsupportedAuthAction("Numeração de certificados");
      },
    },
    portalDomains: {
      async get() {
        return desktopPortalDomain();
      },
      async create() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
      async verify() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
      async activate() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
      async delete() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
    },
    notifications: {
      async getUnreadCount() {
        return { count: 0 };
      },
      async listRecent() {
        return {
          data: [],
          pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
        };
      },
      async markRead() {
        return { updatedIds: [] };
      },
      async markAllRead() {
        return { count: 0 };
      },
      async getPreferences() {
        return desktopNotificationPreferences();
      },
      async updatePreferences(input) {
        return {
          ...desktopNotificationPreferences(),
          ...input,
          preferences: input.preferences ?? {},
        };
      },
    },
    signatures: {
      async getMine() {
        return { hasSignature: false };
      },
      async uploadMine() {
        throw desktopUnsupportedSignatureAction("Assinatura visual");
      },
      async deleteMine() {
        throw desktopUnsupportedSignatureAction("Assinatura visual");
      },
    },
    profileMedia: {
      async uploadAvatar() {
        throw desktopUnsupportedProfileMediaAction("Avatar");
      },
      async deleteAvatar() {
        throw desktopUnsupportedProfileMediaAction("Avatar");
      },
    },
    signingCertificates: {
      async list() {
        return { certificates: [] };
      },
      async upload() {
        throw desktopUnsupportedSigningCertificateAction(
          "Certificado ICP-Brasil",
        );
      },
      async setDefault() {
        throw desktopUnsupportedSigningCertificateAction(
          "Certificado ICP-Brasil",
        );
      },
      async revoke() {
        throw desktopUnsupportedSigningCertificateAction(
          "Certificado ICP-Brasil",
        );
      },
    },
    customers: {
      async list(input) {
        const url = new URL("/api/customers", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar clientes");
        }

        return response.json() as Promise<CustomersListData>;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/customers", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar cliente"),
          );
        }

        return response.json() as Promise<CustomersListData["data"][number]>;
      },
      async get<TCustomer = CustomerDetailData>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar cliente");
        }

        return response.json() as Promise<TCustomer>;
      },
      async update<TCustomer = CustomerDetailData>(
        id: string | number,
        input: UpdateCustomerInput,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar cliente"),
          );
        }

        return response.json() as Promise<TCustomer>;
      },
      async auditLog<TRecord = unknown>(
        id: string | number,
        input: { page?: number; limit?: number } = {},
      ) {
        const url = new URL(
          `/api/customers/${encodeURIComponent(String(id))}/audit-log`,
          options.baseUrl,
        );
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 50));

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar historico");
        }

        return response.json() as Promise<CustomerAuditLogData<TRecord>>;
      },
      async updateCompliance<TCustomer = CustomerDetailData>(
        id: string | number,
        input: UpdateCustomerComplianceInput,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/compliance`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar conformidade"),
          );
        }

        return response.json() as Promise<TCustomer>;
      },
      async listMembers<TMember = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/members`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar usuarios");
        }

        return response.json() as Promise<TMember[]>;
      },
      async listInvitations<TInvitation = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/invitations`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar convites");
        }

        return response.json() as Promise<TInvitation[]>;
      },
      async createInvitation<TInvitation = unknown>(
        id: string | number,
        input: { email: string; role: string },
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/invitations`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao enviar convite"),
          );
        }

        return response.json() as Promise<TInvitation>;
      },
      async resendInvitation(id: string | number, invitationId: string) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(
              String(id),
            )}/invitations/${encodeURIComponent(invitationId)}/resend`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao reenviar convite"),
          );
        }

        return response.json();
      },
      async cancelInvitation(id: string | number, invitationId: string) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(
              String(id),
            )}/invitations/${encodeURIComponent(invitationId)}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao cancelar convite"),
          );
        }

        return response.json();
      },
      async removeMember(id: string | number, memberId: string) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(
              String(id),
            )}/members/${encodeURIComponent(memberId)}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao remover usuário"),
          );
        }

        return response.json();
      },
    },
    assets: {
      async list(input) {
        const url = new URL("/api/assets", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.customerId) {
          url.searchParams.set("customerId", String(input.customerId));
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar ativos");
        }

        return response.json() as Promise<AssetsListData>;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/assets", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar ativo"));
        }

        return response.json() as Promise<AssetsListData["data"][number]>;
      },
      async get<TAsset = AssetDetailData>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/assets/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar ativo");
        }

        return response.json() as Promise<TAsset>;
      },
      async update<TAsset = AssetDetailData>(
        id: string | number,
        input: UpdateAssetInput,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/assets/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar ativo"),
          );
        }

        return response.json() as Promise<TAsset>;
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/assets/${encodeURIComponent(String(id))}/audit-log`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<AssetAuditLogData<TRecord>>;
      },
    },
    assetTypes: {
      async list() {
        const response = await fetchImpl(
          new URL("/api/asset-types", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar tipos de instrumento");
        }

        return response.json() as Promise<AssetTypesListData>;
      },
    },
    environmentalLimits: {
      async list() {
        const session = await getLocalSessionSnapshot();
        const activeUnitId = session.data?.permissions.activeUnitId ?? null;
        return {
          limits: (session.data?.environmentalLimits ?? [])
            .map(environmentalLimitFromUnknown)
            .filter((limit): limit is EnvironmentalLimit => {
              if (!limit) return false;
              return activeUnitId === null || limit.unitId === activeUnitId;
            }),
          unit: {
            unitId: activeUnitId,
            unitName:
              session.data?.activeUnits.find((unit) => unit.id === activeUnitId)
                ?.name ?? null,
          },
        };
      },
      async save() {
        throw desktopUnsupportedAuthAction("Limites ambientais");
      },
      async delete() {
        throw desktopUnsupportedAuthAction("Limites ambientais");
      },
    },
    integrations: {
      async list<TResponse = unknown>() {
        return {
          billing: {
            planId: "desktop-local",
            planName: "Desktop local",
            status: "active",
            hasCustomIntegrations: false,
          },
          data: [],
        } as TResponse;
      },
      async create() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async validate() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async update() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async toggle() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async previewSync() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async sync() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async schedule() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async retryRun() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
    },
    services: {
      async list(input = {}) {
        const url = new URL("/api/services", options.baseUrl);
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 20));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.assetTypeId) {
          url.searchParams.set("assetTypeId", String(input.assetTypeId));
        }

        if (input.methodId) {
          url.searchParams.set("methodId", String(input.methodId));
        }

        if (input.isActive !== undefined) {
          url.searchParams.set("isActive", String(input.isActive));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar serviços");
        }

        return response.json() as Promise<ServicesListData>;
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar serviço");
        }

        return response.json() as Promise<ServiceDetailData>;
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}/audit-log`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<ServiceAuditLogData<TRecord>>;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/services", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar serviço"),
          );
        }

        return response.json() as Promise<{ id: number }>;
      },
      async update(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar serviço"),
          );
        }

        return response.json() as Promise<ServiceDetailData>;
      },
      async deactivate(id) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao desativar serviço"),
          );
        }

        return response.json() as Promise<unknown>;
      },
    },
    methods: {
      async list(input = {}) {
        const url = new URL("/api/methods", options.baseUrl);
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 20));

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.assetTypeId) {
          url.searchParams.set("assetTypeId", String(input.assetTypeId));
        }

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar métodos");
        }

        return response.json() as Promise<MethodsListData>;
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/methods/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar método");
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async audit<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/methods/${encodeURIComponent(String(id))}/audit`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<MethodAuditLogData<TRecord>>;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/methods", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar método"));
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async update(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/methods/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar método"),
          );
        }

        return response.json() as Promise<MethodDetailData>;
      },
      async archive(id) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "archive",
          undefined,
          "Erro ao arquivar método",
        );
      },
      async createNewVersion(id) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "new-version",
          undefined,
          "Erro ao criar nova versão",
        ) as Promise<MethodDetailData>;
      },
      async technicalReview(id) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "technical-review",
          undefined,
          "Erro ao revisar tecnicamente",
        );
      },
      async qualityApprove(id, input = {}) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "quality-approve",
          input,
          "Erro ao aprovar qualidade",
        );
      },
      async returnToDraft(id, reason) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "return-to-draft",
          { reason },
          "Erro ao retornar para rascunho",
        );
      },
    },
    standards: {
      async list(input = {}) {
        const url = new URL("/api/standards", options.baseUrl);
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 20));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrões");
        }

        return response.json() as Promise<StandardsListData>;
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar padrão");
        }

        return response.json() as Promise<StandardData>;
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}/audit-log`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return response.json() as Promise<StandardAuditLogData<TRecord>>;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/standards", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar padrão"));
        }

        return response.json() as Promise<{ id: number }>;
      },
      async update(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar padrão"),
          );
        }

        return response.json() as Promise<StandardData>;
      },
      async delete(id) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao remover padrão"),
          );
        }

        return response.json() as Promise<unknown>;
      },
      async renew(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}/renew`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao renovar certificado"),
          );
        }

        return response.json() as Promise<unknown>;
      },
    },
    jobs: {
      async list(input) {
        const url = new URL("/api/jobs", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.customerId) {
          url.searchParams.set("customerId", String(input.customerId));
        }

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar calibrações");
        }

        return response.json() as Promise<JobsListData>;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/jobs", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar ordem"));
        }

        return response.json() as Promise<CreateJobResult>;
      },
      async get<TJob = unknown>(jobId: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/jobs/${encodeURIComponent(String(jobId))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar job");
        }

        return response.json() as Promise<TJob>;
      },
      async listTechnicians() {
        const response = await fetchImpl(
          new URL("/api/jobs/technicians/list", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar técnicos");
        }

        return response.json() as Promise<TechnicianListData>;
      },
      async approve() {
        throw desktopUnsupportedJobAction("Aprovação de job");
      },
      async reject() {
        throw desktopUnsupportedJobAction("Rejeição de job");
      },
      async cancel() {
        throw desktopUnsupportedJobAction("Cancelamento de job");
      },
      async assign() {
        throw desktopUnsupportedJobAction("Atribuição de técnico");
      },
      async listStandards<TStandard = unknown>() {
        const url = new URL("/api/standards", options.baseUrl);
        url.searchParams.set("status", "ACTIVE");
        url.searchParams.set("limit", "100");

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrões");
        }

        return response.json() as Promise<
          ReferenceStandardsResponse<TStandard>
        >;
      },
      async getEffectiveEnvironmentalLimits<TLimits = unknown>(
        assetTypeId: string | number,
        input: { unitId?: string | number | null } = {},
      ) {
        const url = new URL(
          `/api/environmental-limits/effective/${encodeURIComponent(
            String(assetTypeId),
          )}`,
          options.baseUrl,
        );

        if (input.unitId) {
          url.searchParams.set("unitId", String(input.unitId));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          return { limits: null, source: null };
        }

        return response.json() as Promise<
          EffectiveEnvironmentalLimitsResponse<TLimits>
        >;
      },
      async saveExecution(jobId, input) {
        const response = await fetchImpl(
          new URL(
            `/api/jobs/${encodeURIComponent(String(jobId))}/execute`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao salvar"));
        }

        return response.json();
      },
      async submitExecution(jobId, input) {
        const response = await fetchImpl(
          new URL(
            `/api/jobs/${encodeURIComponent(String(jobId))}/submit`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao submeter"));
        }

        return response.json();
      },
      async createCertificateDraft(jobId) {
        const response = await fetchImpl(
          new URL(
            `/api/jobs/${encodeURIComponent(String(jobId))}/certificate-draft`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao gerar rascunho local do certificado");
        }

        return response.json() as Promise<LocalCertificateDraft>;
      },
      async getCertificateDownloadUrl() {
        throw desktopUnsupportedJobAction("Download de certificado publicado");
      },
      async generateLabel() {
        throw desktopUnsupportedJobAction("Geração de etiqueta publicada");
      },
      async getLabelDownloadUrl() {
        throw desktopUnsupportedJobAction("Download de etiqueta publicada");
      },
      async amend() {
        throw desktopUnsupportedJobAction("Retificação de certificado");
      },
    },
    serviceOrders: {
      async list(input) {
        const url = new URL("/api/service-orders", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Erro ao carregar ordens de serviço");
        }

        return response.json() as Promise<ServiceOrdersListData>;
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Erro ao carregar OS");
        }

        const result = (await response.json()) as { data: ServiceOrderDetail };
        return result.data;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/service-orders", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar OS"));
        }

        return response.json() as Promise<CreateServiceOrderResult>;
      },
      async createQuote(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(String(id))}/quotes`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar orçamento"),
          );
        }

        return response.json();
      },
      async saveEvaluation() {
        throw desktopUnsupportedServiceOrderAction("Avaliação técnica");
      },
      async sendQuote() {
        throw desktopUnsupportedServiceOrderAction("Emissão de orçamento");
      },
      async saveExecution(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(String(id))}/execution`,
            options.baseUrl,
          ),
          {
            method: "PATCH",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar execução"),
          );
        }

        return response.json();
      },
      async generateIntakeDocument() {
        throw desktopUnsupportedServiceOrderAction("Geração de comprovante");
      },
      async getIntakeDocumentPdf() {
        throw desktopUnsupportedServiceOrderAction("Abertura de comprovante");
      },
      async generateTag() {
        throw desktopUnsupportedServiceOrderAction("Geração de etiqueta");
      },
      async getTagPdf() {
        throw desktopUnsupportedServiceOrderAction("Abertura de etiqueta");
      },
      async updateRepairSeal() {
        throw desktopUnsupportedServiceOrderAction("Selo de reparado");
      },
      async deliver() {
        throw desktopUnsupportedServiceOrderAction("Registro de entrega");
      },
      async issueDeliveryDocument(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(
              String(id),
            )}/delivery-document`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(
              response,
              "Erro ao gerar comprovante de entrega",
            ),
          );
        }

        return response.json();
      },
      async getDeliveryDocumentPdf() {
        throw desktopUnsupportedServiceOrderAction(
          "Abertura do comprovante de entrega",
        );
      },
    },
    sync: {
      async getSession() {
        return getLocalSessionSnapshot();
      },
      async listConflicts(input = {}) {
        const url = new URL("/api/local/sync/conflicts", options.baseUrl);

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.limit) {
          url.searchParams.set("limit", String(input.limit));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar conflitos de sincronização");
        }

        return response.json() as Promise<LocalSyncConflictsResponse>;
      },
      async resolveConflict(id, status = "resolved") {
        const response = await fetchImpl(
          new URL(
            `/api/local/sync/conflicts/${encodeURIComponent(id)}/resolve`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ status }),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao resolver conflito de sincronização");
        }

        return response.json() as Promise<{ data: LocalSyncConflict }>;
      },
    },
    attachments: {
      async list(input = {}) {
        const url = new URL("/api/attachments", options.baseUrl);

        if (input.entityType) {
          url.searchParams.set("entityType", input.entityType);
        }

        if (input.entityId) {
          url.searchParams.set("entityId", input.entityId);
        }

        if (input.limit) {
          url.searchParams.set("limit", String(input.limit));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar anexos locais");
        }

        return response.json() as Promise<LocalAttachmentsResponse>;
      },
      async upload(input) {
        const formData = new FormData();
        formData.set("entityType", input.entityType);
        formData.set("entityId", input.entityId);
        formData.set("file", input.file, input.fileName);

        const response = await fetchImpl(
          new URL("/api/attachments", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao anexar arquivo local");
        }

        return response.json() as Promise<LocalAttachment>;
      },
    },
  };
}

export function createDesktopHybridApiClient(
  options: CreateDesktopHybridApiClientOptions,
): CalibraApi {
  const cloud = createCloudApiClient(options.cloud);
  const local = createDesktopApiClient(options.local);
  const requestBackgroundSync = createDesktopBackgroundSyncRequester(
    options.local,
  );

  return {
    ...cloud,
    dashboard: withDesktopLocalFirstReadThroughSync(
      cloud.dashboard,
      local.dashboard,
      local,
      ["getStats"],
      requestBackgroundSync,
    ),
    customers: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.customers,
        local.customers,
        local,
        ["list", "get"],
        requestBackgroundSync,
      ),
      create: local.customers.create,
      update: local.customers.update,
    },
    assets: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.assets,
        local.assets,
        local,
        ["list", "get"],
        requestBackgroundSync,
      ),
      create: local.assets.create,
      update: local.assets.update,
    },
    assetTypes: withDesktopLocalFirstReadThroughSync(
      cloud.assetTypes,
      local.assetTypes,
      local,
      ["list"],
      requestBackgroundSync,
    ),
    services: withDesktopLocalFirstReadThroughSync(
      cloud.services,
      local.services,
      local,
      ["list", "get"],
      requestBackgroundSync,
    ),
    methods: withDesktopLocalFirstReadThroughSync(
      cloud.methods,
      local.methods,
      local,
      ["list", "get"],
      requestBackgroundSync,
    ),
    standards: withDesktopLocalFirstReadThroughSync(
      cloud.standards,
      local.standards,
      local,
      ["list", "get"],
      requestBackgroundSync,
    ),
    environmentalLimits: withDesktopLocalFirstReadThroughSync(
      cloud.environmentalLimits,
      local.environmentalLimits,
      local,
      ["list"],
      requestBackgroundSync,
    ),
    sync: local.sync,
    attachments: local.attachments,
    jobs: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.jobs,
        local.jobs,
        local,
        ["list", "get", "listStandards", "getEffectiveEnvironmentalLimits"],
        requestBackgroundSync,
      ),
      saveExecution: local.jobs.saveExecution,
      submitExecution: local.jobs.submitExecution,
      createCertificateDraft: local.jobs.createCertificateDraft,
    },
    serviceOrders: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.serviceOrders,
        local.serviceOrders,
        local,
        ["list", "get"],
        requestBackgroundSync,
      ),
      create: local.serviceOrders.create,
      createQuote: local.serviceOrders.createQuote,
      saveExecution: local.serviceOrders.saveExecution,
      issueDeliveryDocument: local.serviceOrders.issueDeliveryDocument,
    },
  };
}

function withDesktopLocalFirstReadThroughSync<TNamespace extends object>(
  cloudNamespace: TNamespace,
  localNamespace: TNamespace,
  localApi: CalibraApi,
  readMethods: Array<keyof TNamespace>,
  requestBackgroundSync: () => void,
): TNamespace {
  const namespace = { ...cloudNamespace } as Record<PropertyKey, unknown>;

  for (const method of readMethods) {
    const cloudMethod = cloudNamespace[method];
    const localMethod = localNamespace[method];

    if (
      typeof cloudMethod !== "function" ||
      typeof localMethod !== "function"
    ) {
      continue;
    }

    namespace[method] = async (...args: unknown[]) => {
      if (await hasBootstrappedLocalCache(localApi)) {
        try {
          const result = await (
            localMethod as (...args: unknown[]) => Promise<unknown>
          )(...args);
          requestBackgroundSync();
          return result;
        } catch (localError) {
          try {
            return await (
              cloudMethod as (...args: unknown[]) => Promise<unknown>
            )(...args);
          } catch (cloudError) {
            if (isDesktopOfflineError(cloudError)) {
              throw localError;
            }

            throw cloudError;
          }
        }
      }

      try {
        return await (cloudMethod as (...args: unknown[]) => Promise<unknown>)(
          ...args,
        );
      } catch (error) {
        if (!isDesktopOfflineError(error)) {
          throw error;
        }

        if (!(await hasBootstrappedLocalCache(localApi))) {
          throw new Error(
            getDesktopDataPolicyUnavailableMessage(
              "local-first-read-through-sync",
            ),
            { cause: error },
          );
        }

        return (localMethod as (...args: unknown[]) => Promise<unknown>)(
          ...args,
        );
      }
    };
  }

  return namespace as TNamespace;
}

function createDesktopBackgroundSyncRequester(
  options: CreateDesktopApiClientOptions,
): () => void {
  const fetchImpl = options.fetch ?? fetch;
  let pending: Promise<void> | null = null;
  let lastStartedAt = 0;

  return () => {
    const now = Date.now();
    if (pending || now - lastStartedAt < 60_000) {
      return;
    }

    lastStartedAt = now;
    pending = (async () => {
      const response = await fetchImpl(
        new URL("/api/local/sync/retry", options.baseUrl),
        {
          method: "POST",
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        },
      );

      if (!response.ok) {
        throw new Error(
          "Falha ao atualizar sincronização local em segundo plano",
        );
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        pending = null;
      });
  };
}

async function hasBootstrappedLocalCache(localApi: CalibraApi) {
  try {
    const session = await localApi.sync.getSession();
    return Boolean(session.data?.syncCursor);
  } catch {
    return false;
  }
}

function isDesktopOfflineError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return /fetch|network|failed to fetch|load failed|connection|err_/i.test(
    error.message,
  );
}

async function readApiError(response: Response, fallback: string) {
  const body = await response.text();
  if (!body) return fallback;

  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? fallback;
  } catch {
    return body;
  }
}

function emptyGovernanceResponse() {
  return {
    data: [],
    viewer: {
      isGlobalManager: false,
      canManageOrganizationUnits: false,
      canManageAssignments: false,
      canManageGlobalRoles: false,
      canViewGovernance: false,
      canAccessConsolidatedView: false,
      managedUnitIds: [],
    },
  };
}

async function readOptionalForbiddenResponse<TResponse>(
  response: Response,
  forbiddenValue: unknown,
  fallback: string,
) {
  if (response.status === 403) {
    return forbiddenValue as TResponse;
  }

  if (!response.ok) {
    throw new Error(await readApiError(response, fallback));
  }

  return response.json() as Promise<TResponse>;
}

async function readMutationResponse<TResponse>(
  response: Response,
  fallback: string,
) {
  const data = await response.json().catch(() => null);

  if (!response.ok || hasApiError(data)) {
    throw new Error(apiErrorMessage(data) ?? fallback);
  }

  return data as TResponse;
}

function hasApiError(value: unknown): value is { error?: unknown } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

function apiErrorMessage(value: unknown) {
  if (hasApiError(value) && typeof value.error === "string") {
    return value.error;
  }

  return null;
}

async function parseCloudEntityLabel(
  response: Response,
  entityName: string,
): Promise<string | null> {
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${entityName} label`);
  }

  const data = (await response.json()) as EntityLabelResponse;
  return data.label ?? null;
}

function buildDesktopUnitsResponse(
  session: LocalSessionSnapshotResponse["data"],
): DashboardUnitsResponse | null {
  if (!session) return null;

  const activeUnitId = session.permissions.activeUnitId;
  const activeUnit =
    session.activeUnits.find((unit) => unit.id === activeUnitId) ??
    session.activeUnits[0] ??
    null;
  const canAccessAllUnits = session.permissions.canAccessAllUnits;
  const selectedUnitScope =
    canAccessAllUnits && !activeUnitId ? ("all" as const) : ("unit" as const);
  const effectiveRole =
    session.permissions.unitRole ?? session.permissions.role ?? "member";
  const unitSummaries = session.activeUnits.map((unit) => ({
    id: unit.id,
    name: unit.name,
    slug: slugifyUnitName(unit.name, unit.id),
    role: unit.role ?? effectiveRole,
  }));

  return {
    activeUnitId: activeUnit?.id ?? null,
    activeUnitName: activeUnit?.name ?? null,
    selectedUnitScope,
    canAccessAllUnits,
    data: unitSummaries,
    viewer: {
      isGlobalManager: canAccessAllUnits,
      canManageOrganizationUnits: false,
      canManageAssignments: false,
      canManageGlobalRoles: false,
      canViewGovernance: false,
      canAccessConsolidatedView: canAccessAllUnits,
      managedUnitIds: [],
    },
    scopeSummary: {
      isConsolidated: selectedUnitScope === "all",
      activeUnitId: activeUnit?.id ?? null,
      activeUnitName: activeUnit?.name ?? null,
      accessibleUnitsCount: unitSummaries.length,
      managedUnitsCount: 0,
      effectiveRole,
      effectiveRoleLabel: roleLabel(effectiveRole),
      label:
        selectedUnitScope === "all"
          ? "Todas as unidades"
          : (activeUnit?.name ?? "Unidade local"),
      description:
        selectedUnitScope === "all"
          ? "Dados locais sincronizados de todas as unidades acessiveis neste dispositivo."
          : "Dados locais sincronizados para a unidade ativa neste dispositivo.",
    },
  };
}

function slugifyUnitName(name: string, id: number) {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `unit-${id}`;
}

function roleLabel(role: string) {
  switch (role) {
    case "admin":
    case "owner":
      return "Administrador";
    case "technical_manager":
      return "Responsavel tecnico";
    case "unit_admin":
      return "Admin. da unidade";
    case "technician":
      return "Tecnico";
    default:
      return "Membro";
  }
}

function desktopPlanAccess(): PlanAccessResponse {
  return {
    planId: "desktop-local",
    planName: "Desktop local",
    status: "active",
    limits: {
      certificates: -1,
      users: -1,
      storage: -1,
    },
    entitlements: ["desktop_local"],
    hasFinancial: false,
    hasFinancialModule: false,
    canManageBilling: false,
    hasApi: false,
    hasCustomDomain: false,
    hasCustomTemplates: true,
    hasSso: false,
  };
}

function desktopFinanceAccess(): FinanceAccessResponse {
  return {
    planId: "desktop-local",
    planName: "Desktop local",
    status: "active",
    entitlements: ["desktop_local"],
    hasFinancialModule: false,
    hasCustomIntegrations: false,
    canReadFinancial: false,
    canManageFinancial: false,
    canExportFinancial: false,
    role: "desktop",
  };
}

function desktopBillingSubscription(): BillingSubscriptionResponse {
  const access = desktopPlanAccess();

  return {
    subscription: null,
    plan: {
      id: access.planId,
      name: access.planName,
      description: "Plano local do aplicativo desktop",
    },
    usage: {
      jobsCreated: 0,
      users: 1,
      storage: 0,
    },
    limits: access.limits,
  };
}

function desktopSsoSettings(): SsoSettingsResponse {
  const access = desktopPlanAccess();

  return {
    provider: null,
    access: {
      role: "desktop",
      canCreate: false,
      canManage: false,
      canDelete: false,
    },
    billing: {
      planId: access.planId,
      planName: access.planName,
      status: access.status,
      hasSso: false,
    },
  };
}

function desktopCertificateNumberingProfile(): CertificateNumberingProfileResponse {
  const config: CertificateNumberingConfig = {
    labCode: "CAL",
    projectCode: null,
    numberTemplate: "{labCode}-{yyyy}-{seq}",
    certificateNameTemplate: "Certificado {number}",
    sequence: {
      resetScope: "year",
      startAt: 1,
      increment: 1,
      padding: 4,
    },
  };

  return {
    profile: {
      id: null,
      name: "Padrao",
      config,
      createdAt: null,
      updatedAt: null,
    },
    example: {
      number: "CAL-2026-0123",
      name: "Certificado CAL-2026-0123",
      sequenceKey: "year:2026",
    },
    supportedTokens: [
      "{labCode}",
      "{labName}",
      "{labSlug}",
      "{projectCode}",
      "{yyyy}",
      "{yy}",
      "{mm}",
      "{mon}",
      "{dd}",
      "{seq}",
      "{number}",
    ],
  };
}

function desktopPortalDomain(): PortalDomainResponse {
  return {
    portalBaseUrl: "",
    domain: null,
    statusSummary: {
      status: "not_configured",
      readiness: "not_ready",
      canActivate: false,
      message: "Domínio customizado do portal requer a API web/nuvem.",
      diagnostics: {
        host: null,
        expectedValue: null,
        observedValues: [],
      },
    },
  };
}

function environmentalLimitFromUnknown(
  value: unknown,
): EnvironmentalLimit | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = numberFromUnknown(row.id);
  const unitId = numberFromUnknown(row.unitId);

  if (id === null || unitId === null) return null;

  return {
    id,
    unitId,
    assetTypeId: numberFromUnknown(row.assetTypeId),
    assetTypeName:
      typeof row.assetTypeName === "string" ? row.assetTypeName : null,
    temperatureMin: numberFromUnknown(row.temperatureMin),
    temperatureMax: numberFromUnknown(row.temperatureMax),
    humidityMin: numberFromUnknown(row.humidityMin),
    humidityMax: numberFromUnknown(row.humidityMax),
    pressureMin: numberFromUnknown(row.pressureMin),
    pressureMax: numberFromUnknown(row.pressureMax),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function desktopNotificationPreferences(): NotificationPreferencesResponse {
  return {
    preferences: {},
    emailEnabled: false,
    notifySelfActions: false,
    digestFrequency: "NONE",
  };
}

function desktopUnsupportedServiceOrderAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function desktopUnsupportedJobAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function desktopUnsupportedSignatureAction(action: string) {
  return new Error(`${action} requer sincronização com a nuvem neste momento.`);
}

function desktopUnsupportedProfileMediaAction(action: string) {
  return new Error(`${action} requer sincronização com a nuvem neste momento.`);
}

function desktopUnsupportedSigningCertificateAction(action: string) {
  return new Error(`${action} requer sincronização com a nuvem neste momento.`);
}

function desktopUnsupportedBackofficeAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function desktopUnsupportedAuthAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function appendNamedBlob(
  formData: FormData,
  name: string,
  file: Blob,
  fileName: string | undefined,
) {
  if (fileName) {
    formData.append(name, file, fileName);
    return;
  }

  formData.append(name, file);
}

function createCloudHeaders(
  activeUnitProvider: ActiveUnitProvider | undefined,
) {
  const headers = new Headers();
  const activeUnitId = activeUnitProvider?.();

  if (activeUnitId) {
    headers.set("x-active-unit-id", activeUnitId);
  }

  return headers;
}

async function postDesktopMethodAction(
  fetchImpl: typeof fetch,
  options: CreateDesktopApiClientOptions,
  id: string | number,
  action: string,
  input: MethodWriteInput | undefined,
  fallback: string,
): Promise<unknown> {
  const response = await fetchImpl(
    new URL(
      `/api/methods/${encodeURIComponent(String(id))}/${action}`,
      options.baseUrl,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: await createDesktopHeaders(
        options.tokenProvider,
        input === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      ),
      body: input === undefined ? undefined : JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response, fallback));
  }

  return response.json() as Promise<unknown>;
}

async function createDesktopHeaders(
  tokenProvider: CreateDesktopApiClientOptions["tokenProvider"],
  init?: HeadersInit,
) {
  const headers = new Headers(init);
  const token = await tokenProvider?.();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

export function isDesktopRuntime(windowLike?: Window): boolean {
  const currentWindow =
    windowLike ?? (typeof window === "undefined" ? undefined : window);
  if (!currentWindow) {
    return false;
  }

  return (
    Boolean(currentWindow.calibraBridge) ||
    currentWindow.navigator.userAgent.includes("Electron")
  );
}

export async function getDesktopApiBaseUrl(
  bridge: CalibraBridge,
): Promise<string | null> {
  const bootstrap = await bridge.getLocalEnvironmentBootstrap();
  return bootstrap?.httpBaseUrl ?? null;
}

declare global {
  interface Window {
    calibraBridge?: CalibraBridge;
  }
}
