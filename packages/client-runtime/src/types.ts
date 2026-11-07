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
  MassCompositionProfileCreateSchema,
  CreateCustomerSchema,
  CreateCustomerGroupSchema,
  CreateJobSchema,
  CreateMaterialSchema,
  CreateNonConformanceSchema,
  CreateServiceOrderSchema,
  FromTemplateSchema,
  UpdateCustomerSchema,
  UpdateMaterialSchema,
  UpdateNotificationPreferencesSchema,
} from "@calibra-facil/schemas";
import type { OrganizationMediaApi } from "./modules/organization-media";
import type { ProfileMediaApi } from "./modules/profile-media";
import type { LabSetupApi } from "./modules/lab-setup";
import type { EndpointGroups } from "@calibra-facil/contracts";
import type { EndpointClient } from "./transport/endpoint-client";
import type { CustomersApi } from "./modules/customers";
import type { EntityLabelsApi } from "./modules/entity-labels";
import type { JobsApi } from "./modules/jobs";
import type { EnvironmentalLimitsApi } from "./modules/environmental-limits";
import type { MethodsApi } from "./modules/methods";
import type { ServiceOrdersApi } from "./modules/service-orders";
import type { SignaturesApi } from "./modules/signatures";
import type { StandardsApi } from "./modules/standards";
import type { UnitsApi } from "./modules/units";

export type AdjustMaterialStockInput = z.input<
  typeof AdjustMaterialStockSchema
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
export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;
export type UpdateMaterialInput = z.input<typeof UpdateMaterialSchema>;
export type UpdateNotificationPreferencesInput = z.input<
  typeof UpdateNotificationPreferencesSchema
>;

import type {
  SelfServeSignupResponse,
  ActivationChecklistResponse,
  ActivationStepId,
  FinanceAccessResponse,
  LabSetupMetadata,
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
  ApiKeySecretResponse,
  ApiKeysListResponse,
  EmailDomainResponse,
  NotificationPreferencesResponse,
  NotificationSummary,
  NotificationsListResponse,
  UnreadNotificationsResponse,
  CertificateNumberingConfig,
  CertificateNumberingProfileResponse,
  AssetTypeListItem,
  AssetTypesResponse,
  CnpjLookupResult,
  DashboardJob,
  DashboardStats,
  MySignatureResponse,
  SignatureUploadResponse,
  UpdateCertificateNumberingProfileResponse,
  CustomerDetail,
  CustomerGroupDetailData,
  CustomerGroupsListData,
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
  ServiceAuditLogEntry,
  ServiceRecord,
  ServicesListResponse,
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
  StandardsListResponse,
  SyncStatusSnapshot,
  UnitsContext,
} from "@calibra-facil/contracts";
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

export type { JobsApi };

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

export type ServicesListData = ServicesListResponse;
export type ServiceDetailData = ServiceRecord;
export type { ServiceAuditLogEntry };

export type MaterialsListData = MaterialsListResponse;
export type MaterialDetailData = MaterialRecord;
export type AdjustMaterialStockData = AdjustMaterialStockResponse;

export type MethodsListData = MethodsListResponse;
export type MethodDetailData = MethodDetail;
export type { MethodGovernance, MethodTemplateCatalogEntry };
export type MethodFromTemplateInput = z.input<typeof FromTemplateSchema>;
export type { MethodsApi };

export type StandardStatus = ReferenceStandardStatus;

/** A standard as the list and the detail return it (contract type). */
export type StandardData = Standard;
export type StandardsListData = StandardsListResponse;

/** A row of the normalized mass composition-profile catalog (per organization). */
export type MassCompositionProfileDto = MassCompositionProfile;
export type MassCompositionProfilesData = MassCompositionProfilesResponse;
export type MassCompositionProfileWriteInput = z.input<
  typeof MassCompositionProfileCreateSchema
>;
export type { StandardsApi };

export type { CnpjLookupResult };
export type CustomersListData = CustomersListResponse;
export type CustomerDetailData = CustomerDetail;
export type { CustomersApi };

export type { CustomerGroupDetailData, CustomerGroupsListData };

export type { AssetStatus };
export type AssetsListData = AssetsListResponse;
export type AssetDetailData = AssetDetail;
export type { AssetAuditLogEntry };

export type AssetTypesListData = AssetTypesResponse;
export type { AssetTypeListItem };

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

export type CreateServiceOrderInput = z.input<typeof CreateServiceOrderSchema>;
export type ServiceOrdersListData = ServiceOrdersListResponse;
export type {
  ServiceOrderCommunicationStatus,
  ServiceOrderDetail,
  ServiceOrdersApi,
};

export type DashboardJobStatus = JobStatus;
export type { DashboardJob, DashboardStats };

/** GET /api/units: the unit context of the session. */
export type DashboardUnitsResponse = UnitsContext;
export type { UnitsApi };

export type {
  ActivationChecklistResponse,
  ActivationStepId,
  FinanceAccessResponse,
};

export type { SelfServeSignupResponse };

export type { SsoSettingsResponse, SsoVerificationRecord };

export type { ApiKeySecretResponse, ApiKeysListResponse };

export type { EntityLabelsApi };

export type CertificateNumberingResetScope =
  CertificateNumberingConfig["sequence"]["resetScope"];
export type {
  CertificateNumberingConfig,
  CertificateNumberingProfileResponse,
  UpdateCertificateNumberingProfileResponse,
};

export type { PortalDomainResponse };

export type { EmailDomainResponse };

export type {
  NotificationPreferencesResponse,
  NotificationSummary,
  NotificationsListResponse,
  UnreadNotificationsResponse,
};

export type { MySignatureResponse, SignatureUploadResponse, SignaturesApi };

export type { OrganizationMediaApi, ProfileMediaApi };

export type {
  SigningCertificate,
  SigningCertificatesListResponse,
  UnsignedIssuanceSetting,
};

export type { LabSetupApi, LabSetupMetadata };

/**
 * The namespaces whose client adds logic to its endpoint group (a 404 that is a
 * result, a multipart upload, an envelope that is unwrapped); every other
 * namespace of `ENDPOINT_GROUPS` is `EndpointClient<group>` as it is.
 */
type ClientModules = {
  customers: CustomersApi;
  units: UnitsApi;
  jobs: JobsApi;
  environmentalLimits: EnvironmentalLimitsApi;
  entityLabels: EntityLabelsApi;
  labSetup: LabSetupApi;
  methods: MethodsApi;
  serviceOrders: ServiceOrdersApi;
  signatures: SignaturesApi;
  profileMedia: ProfileMediaApi;
  organizationMedia: OrganizationMediaApi;
  standards: StandardsApi;
};

/** One namespace per endpoint group, then the desktop-only ones. */
export type CalibraApi = {
  [Namespace in keyof EndpointGroups]: Namespace extends keyof ClientModules
    ? ClientModules[Namespace]
    : EndpointClient<EndpointGroups[Namespace]>;
} & {
  sync: SyncApi;
  attachments: AttachmentsApi;
};
