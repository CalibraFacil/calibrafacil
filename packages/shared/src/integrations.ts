export type IntegrationType = "financial_erp";

export type IntegrationProvider = "generic_http" | "conta_azul";

export const INTEGRATION_PROVIDER_CAPABILITY_FLAGS = [
  "canCreateCustomers",
  "canCreateSuppliers",
  "canCreateTransporters",
  "canCreateCatalogItems",
  "canCreateBudgets",
  "canCreateSales",
  "canCreateReceivables",
  "canCreatePayables",
  "canCreateContracts",
  "canReadReceivableStatus",
  "canReadInstallments",
  "canReadPayableStatus",
  "canReadFiscalDocuments",
  "canIssueFiscalDocuments",
  "canReadRemoteDocumentLinks",
  "canSyncContracts",
  "canUseWebhooks",
  "requiresPolling",
  "supportsCostCenters",
  "supportsCategories",
  "supportsRateio",
  "supportsSellers",
  "supportsBranchAddresses",
] as const;

export type IntegrationProviderCapabilityFlag =
  (typeof INTEGRATION_PROVIDER_CAPABILITY_FLAGS)[number];

export type IntegrationProviderCapabilities = Record<
  IntegrationProviderCapabilityFlag,
  boolean
>;

const noProviderCapabilities: IntegrationProviderCapabilities = {
  canCreateCustomers: false,
  canCreateSuppliers: false,
  canCreateTransporters: false,
  canCreateCatalogItems: false,
  canCreateBudgets: false,
  canCreateSales: false,
  canCreateReceivables: false,
  canCreatePayables: false,
  canCreateContracts: false,
  canReadReceivableStatus: false,
  canReadInstallments: false,
  canReadPayableStatus: false,
  canReadFiscalDocuments: false,
  canIssueFiscalDocuments: false,
  canReadRemoteDocumentLinks: false,
  canSyncContracts: false,
  canUseWebhooks: false,
  requiresPolling: false,
  supportsCostCenters: false,
  supportsCategories: false,
  supportsRateio: false,
  supportsSellers: false,
  supportsBranchAddresses: false,
};

export const INTEGRATION_PROVIDER_CAPABILITIES = {
  generic_http: {
    ...noProviderCapabilities,
    canCreateCustomers: true,
    canCreateReceivables: true,
  },
  conta_azul: {
    ...noProviderCapabilities,
    canCreateCustomers: true,
    canCreateSuppliers: true,
    canCreateTransporters: true,
    canCreateCatalogItems: true,
    canCreateBudgets: true,
    canCreateSales: true,
    canCreateReceivables: true,
    canCreatePayables: true,
    canCreateContracts: true,
    canReadReceivableStatus: true,
    canReadInstallments: true,
    canReadPayableStatus: true,
    canReadFiscalDocuments: true,
    canReadRemoteDocumentLinks: true,
    canSyncContracts: true,
    requiresPolling: true,
    supportsCostCenters: true,
    supportsCategories: true,
    supportsSellers: true,
  },
} as const satisfies Record<
  IntegrationProvider,
  IntegrationProviderCapabilities
>;

export function getProviderCapabilities(
  provider: IntegrationProvider,
): IntegrationProviderCapabilities {
  return { ...INTEGRATION_PROVIDER_CAPABILITIES[provider] };
}

export function providerSupports(
  provider: IntegrationProvider,
  flag: IntegrationProviderCapabilityFlag,
) {
  return INTEGRATION_PROVIDER_CAPABILITIES[provider][flag];
}

export type IntegrationStatus = "ACTIVE" | "DISABLED" | "ACTION_REQUIRED";

export type IntegrationSetupStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "READY"
  | "ACTION_REQUIRED";

export type IntegrationReadinessStatus = "NOT_READY" | "READY" | "DEGRADED";

export type IntegrationSyncTarget =
  | "catalog_item"
  | "contract"
  | "customer"
  | "supplier"
  | "transporter"
  | "service_order"
  | "billing_document"
  | "payable";

export type IntegrationObjectLinkTarget =
  | IntegrationSyncTarget
  | "baixa"
  | "budget"
  | "catalog_item"
  | "category"
  | "contract"
  | "cost_center"
  | "dre_category"
  | "expense"
  | "financial_account"
  | "financial_transfer"
  | "fiscal_document"
  | "payable"
  | "payable_installment"
  | "product"
  | "protocol"
  | "receivable_installment"
  | "remote_document"
  | "sale"
  | "seller"
  | "service"
  | "supplier"
  | "transporter";

const INTEGRATION_SYNC_TARGETS = [
  "catalog_item",
  "contract",
  "customer",
  "supplier",
  "transporter",
  "service_order",
  "billing_document",
  "payable",
] as const satisfies readonly IntegrationSyncTarget[];

export type IntegrationSyncTrigger = "manual" | "event" | "scheduled" | "retry";

export type IntegrationRunMode = "disabled" | "manual_only" | "scheduled";

export type IntegrationScheduleFrequency = "daily" | "weekly";

export type IntegrationScheduleStatus =
  | "disabled"
  | "manual_only"
  | "scheduled"
  | "due"
  | "running"
  | "blocked"
  | "failing";

export type IntegrationSyncStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL";

export type IntegrationSyncItemOperation =
  | "create"
  | "update"
  | "upsert"
  | "poll"
  | "reconcile"
  | "link"
  | "validate"
  | "delete";

export type IntegrationSyncItemStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "DEAD_LETTER";

export type IntegrationEventLevel = "info" | "warning" | "error";

export type IntegrationCredentialType = "bearer" | "oauth2";

export type ContaAzulExportMode =
  | "budget_to_sale"
  | "contract_generated"
  | "receivable_event"
  | "sale"
  | "sale_and_receivable";

export type ContaAzulBudgetMode = "sales_search_link";

export type ContaAzulFiscalMode = "consultation_only" | "disabled";

export type ContaAzulProtocolMode = "api_lookup_verified" | "metadata_only";

export type ContaAzulSaleTrigger =
  | "billing_document_issued"
  | "certificate_approved"
  | "manual"
  | "quote_approved"
  | "service_order_approved"
  | "service_order_completed";

export type ContaAzulSyncDomain =
  | "baixas"
  | "balances"
  | "billingDocuments"
  | "budgets"
  | "categories"
  | "contracts"
  | "costCenters"
  | "customers"
  | "dreCategories"
  | "driftChecks"
  | "expenses"
  | "financialAccounts"
  | "fiscalDocuments"
  | "inventoryTaxonomy"
  | "payables"
  | "paymentStatusPolling"
  | "products"
  | "protocols"
  | "receivables"
  | "remoteDocuments"
  | "sales"
  | "sellers"
  | "services"
  | "suppliers"
  | "transfers"
  | "transporters";

export type ContaAzulReferenceDomain =
  | "accounts"
  | "balances"
  | "categories"
  | "cest"
  | "costCenters"
  | "dreCategories"
  | "ncm"
  | "productCategories"
  | "productEcommerceBrands"
  | "productEcommerceCategories"
  | "products"
  | "protocols"
  | "sellers"
  | "serviceCategories"
  | "transfers"
  | "units";

export type ContaAzulEnabledTargetsConfig = Record<
  ContaAzulSyncDomain,
  boolean
>;

export const CONTA_AZUL_SYNC_DOMAINS = [
  "customers",
  "suppliers",
  "transporters",
  "services",
  "products",
  "inventoryTaxonomy",
  "budgets",
  "sellers",
  "sales",
  "contracts",
  "billingDocuments",
  "receivables",
  "payables",
  "expenses",
  "financialAccounts",
  "balances",
  "transfers",
  "categories",
  "dreCategories",
  "costCenters",
  "baixas",
  "paymentStatusPolling",
  "fiscalDocuments",
  "remoteDocuments",
  "protocols",
  "driftChecks",
] as const satisfies readonly ContaAzulSyncDomain[];

export type IntegrationMappingValueMode = "source" | "constant";

export type IntegrationMappingFormatter =
  | "none"
  | "string"
  | "number"
  | "boolean"
  | "upper_case"
  | "lower_case"
  | "digits_only"
  | "date_only"
  | "iso_datetime"
  | "currency_major";

export type IntegrationDependencyWarningCode =
  | "CATALOG_NOT_ENABLED"
  | "CUSTOMERS_NOT_SYNCED"
  | "SUPPLIERS_NOT_SYNCED"
  | "SERVICE_ORDERS_NOT_SYNCED"
  | "VALIDATION_REQUIRED"
  | "REMOTE_CONFIG_MISSING"
  | "INTEGRATION_DISABLED";

export const DEFAULT_GENERIC_ERP_PATHS = {
  health: "/health",
  customers: "/customers",
  serviceOrders: "/service-orders",
  billingDocuments: "/billing-documents",
} as const;

export const CONTA_AZUL_API_BASE_URL = "https://api-v2.contaazul.com" as const;

export const DEFAULT_CONTA_AZUL_SCOPES = [
  "openid",
  "profile",
  "aws.cognito.signin.user.admin",
] as const;

export const DEFAULT_INTEGRATION_SCHEDULE_FREQUENCY: IntegrationScheduleFrequency =
  "daily";

export interface IntegrationTargetScheduleConfig {
  mode: IntegrationRunMode;
  frequency: IntegrationScheduleFrequency;
  nextScheduledRunAt: string | null;
  lastScheduledRunAt: string | null;
}

export interface IntegrationTargetScheduleSummary {
  target: IntegrationSyncTarget;
  mode: IntegrationRunMode;
  frequency: IntegrationScheduleFrequency;
  status: IntegrationScheduleStatus;
  nextScheduledRunAt: string | null;
  lastScheduledRunAt: string | null;
}

export interface IntegrationFieldMappingRule {
  id: string;
  destinationField: string;
  enabled: boolean;
  valueMode: IntegrationMappingValueMode;
  sourceField: string | null;
  constantValue: string | null;
  formatter: IntegrationMappingFormatter;
}

export interface IntegrationTargetMappingConfig {
  fields: IntegrationFieldMappingRule[];
}

export type IntegrationMappingsConfig = Record<
  IntegrationSyncTarget,
  IntegrationTargetMappingConfig
>;

export interface GenericFinancialErpConnectionConfig {
  baseUrl: string;
  healthPath: string;
  customerPath: string;
  serviceOrderPath: string;
  billingDocumentPath: string;
  authType: IntegrationCredentialType;
  schedules: Record<IntegrationSyncTarget, IntegrationTargetScheduleConfig>;
  mappings: IntegrationMappingsConfig;
}

export interface ContaAzulConnectionConfig {
  provider: "conta_azul";
  baseUrl: typeof CONTA_AZUL_API_BASE_URL;
  accountId: string | null;
  connectedCompanyName: string | null;
  scopes: string[];
  accessTokenExpiresAt: string | null;
  defaultFinancialAccountId: string | null;
  defaultCategoryId: string | null;
  defaultCostCenterId: string | null;
  defaultDreCategoryId: string | null;
  defaultExpenseCategoryId: string | null;
  defaultPaymentMethodId: string | null;
  defaultProductCategoryId: string | null;
  defaultSellerId: string | null;
  defaultServiceCategoryId: string | null;
  defaultUnitOfMeasureId: string | null;
  budgetMode: ContaAzulBudgetMode;
  fiscalMode: ContaAzulFiscalMode;
  defaultFiscalTaxonomy: Record<string, unknown> | null;
  protocolMode: ContaAzulProtocolMode;
  saleTrigger: ContaAzulSaleTrigger;
  exportMode: ContaAzulExportMode;
  enabledTargets: ContaAzulEnabledTargetsConfig;
  polling: {
    receivablesLastRemoteUpdatedAt: string | null;
    payablesLastRemoteUpdatedAt: string | null;
    invoicesLastRemoteUpdatedAt: string | null;
    protocolsLastRemoteUpdatedAt: string | null;
    driftLastCheckedAt: string | null;
  };
  schedules: Record<IntegrationSyncTarget, IntegrationTargetScheduleConfig>;
  mappings: IntegrationMappingsConfig;
}

export type FinancialErpConnectionConfig =
  | GenericFinancialErpConnectionConfig
  | ContaAzulConnectionConfig;

export type ContaAzulConnectionConfigInput = Partial<
  Omit<
    ContaAzulConnectionConfig,
    | "baseUrl"
    | "budgetMode"
    | "defaultFiscalTaxonomy"
    | "enabledTargets"
    | "exportMode"
    | "fiscalMode"
    | "mappings"
    | "polling"
    | "protocolMode"
    | "saleTrigger"
    | "schedules"
  >
> & {
  baseUrl?: string | null;
  budgetMode?: unknown;
  defaultFiscalTaxonomy?: unknown;
  enabledTargets?: Partial<ContaAzulEnabledTargetsConfig> | null;
  exportMode?: unknown;
  fiscalMode?: unknown;
  polling?: Partial<ContaAzulConnectionConfig["polling"]> | null;
  protocolMode?: unknown;
  saleTrigger?: unknown;
  schedules?: Partial<
    Record<IntegrationSyncTarget, Partial<IntegrationTargetScheduleConfig>>
  > | null;
  mappings?: Partial<
    Record<IntegrationSyncTarget, Partial<IntegrationTargetMappingConfig>>
  > | null;
};

export interface IntegrationCustomerPayload {
  externalId: string;
  organizationId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  addressParts?: IntegrationCustomerAddress;
  createdAt: string | null;
  updatedAt: string | null;
}

export type IntegrationPessoaRole = "customer" | "supplier" | "transporter";

export interface IntegrationPessoaPayload extends IntegrationCustomerPayload {
  pessoaRole: IntegrationPessoaRole;
}

export interface IntegrationSupplierPayload extends IntegrationPessoaPayload {
  pessoaRole: "supplier";
}

export interface IntegrationTransporterPayload extends IntegrationPessoaPayload {
  pessoaRole: "transporter";
}

export interface IntegrationCatalogItemPayload {
  externalId: string;
  organizationId: string;
  kind: "product" | "service";
  code: string | null;
  name: string;
  description: string | null;
  priceCents: number | null;
  currency: string | null;
  unitOfMeasureId: string | null;
  categoryId: string | null;
  fiscalMetadata: Record<string, unknown> | null;
  active: boolean;
}

export interface IntegrationServiceOrderPayload {
  externalId: string;
  organizationId: string;
  unitId: number | null;
  unitName: string | null;
  jobId: string;
  status: string;
  customerExternalId: string | null;
  customerName: string | null;
  serviceExternalId?: string | null;
  assetName: string | null;
  assetTag: string | null;
  serviceName: string | null;
  servicePriceCents: number | null;
  currency: string | null;
  performedAt: string | null;
  approvedAt: string | null;
  updatedAt: string | null;
}

export interface IntegrationBillingDocumentPayload {
  externalId: string;
  documentNumber: string | null;
  organizationId: string;
  unitId: number | null;
  unitName: string | null;
  customerExternalId: string | null;
  customerName: string | null;
  totalCents: number;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  status: "draft" | "issued" | "paid" | "overdue" | "void";
  items: Array<{
    lineId: string;
    jobId: string | null;
    catalogItemExternalId?: string | null;
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
}

export interface IntegrationCommercialItemPayload {
  lineId: string;
  catalogItemExternalId: string | null;
  remoteItemId?: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  unitCostCents?: number | null;
}

export interface IntegrationPaymentInstallmentPayload {
  dueDate: string;
  amountCents: number;
  description: string | null;
}

export interface IntegrationPaymentTermsPayload {
  paymentMethodId: string | null;
  financialAccountId: string | null;
  paymentConditionLabel: string | null;
  dueDate: string | null;
  dueDay?: number | null;
  firstDueDate?: string | null;
  installments: IntegrationPaymentInstallmentPayload[];
}

export interface IntegrationBudgetPayload {
  externalId: string;
  organizationId: string;
  customerExternalId: string | null;
  budgetNumber: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  status: string;
  sellerExternalId: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  totalCents: number;
  currency: string;
  notes: string | null;
  items: IntegrationCommercialItemPayload[];
  paymentTerms: IntegrationPaymentTermsPayload | null;
}

export interface IntegrationSalePayload {
  externalId: string;
  organizationId: string;
  customerExternalId: string | null;
  saleNumber: string | null;
  saleDate: string | null;
  status: string;
  sellerExternalId: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  totalCents: number;
  currency: string;
  notes: string | null;
  items: IntegrationCommercialItemPayload[];
  paymentTerms: IntegrationPaymentTermsPayload | null;
}

export interface IntegrationPayablePayload {
  externalId: string;
  organizationId: string;
  supplierExternalId: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  amountCents: number;
  currency: string;
  categoryId: string | null;
  costCenterId: string | null;
  notes: string | null;
}

export type IntegrationFiscalDocumentType = "nfe" | "nfse";

export type IntegrationMdfeLinkStatus =
  | "AUTORIZADO"
  | "ENCERRADO"
  | "CANCELADO";

export interface IntegrationFiscalDocumentMetadata {
  fiscalDocumentType: IntegrationFiscalDocumentType;
  remoteEntityId: string | null;
  accessKey: string | null;
  number: string | null;
  status: string | null;
  issuedAt: string | null;
  customerName: string | null;
  customerDocument: string | null;
  saleRemoteId: string | null;
  contractRemoteId: string | null;
  saleNumber: string | null;
  totalAmountCents: number | null;
  xmlAvailable: boolean;
  consultationOnly: boolean;
  rawMetadata: Record<string, unknown>;
}

export interface IntegrationMdfeLinkPayload {
  externalId: string;
  organizationId: string;
  fiscalDocumentAccessKeys: string[];
  mdfeIdentifier: string;
  status: IntegrationMdfeLinkStatus | null;
}

export interface IntegrationContractPayload {
  externalId: string;
  organizationId: string;
  customerExternalId: string | null;
  contractNumber: string | null;
  recurrence: string | null;
  issueDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sellerExternalId: string | null;
  totalCents: number;
  currency: string;
  categoryId: string | null;
  costCenterId: string | null;
  notes: string | null;
  items: IntegrationCommercialItemPayload[];
  paymentTerms: IntegrationPaymentTermsPayload | null;
}

export interface ContaAzulReferenceItem {
  id: string;
  name: string;
  code: string | null;
  active: boolean | null;
  metadata: Record<string, unknown> | null;
}

export interface ContaAzulReferencePage {
  domain: ContaAzulReferenceDomain;
  items: ContaAzulReferenceItem[];
  nextCursor: string | null;
}

export interface IntegrationDependencyWarning {
  code: IntegrationDependencyWarningCode;
  target: IntegrationSyncTarget;
  severity: "warning" | "error";
  message: string;
}

export interface IntegrationTargetCoverageSummary {
  target: IntegrationSyncTarget;
  localCount: number;
  linkedCount: number;
  unlinkedCount: number;
}

export interface IntegrationTargetSyncSummary {
  target: IntegrationSyncTarget;
  lastRunAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastStatus: IntegrationSyncStatus | null;
  lastTrigger: IntegrationSyncTrigger | null;
  processedCount: number;
  successCount: number;
  errorCount: number;
  blocked: boolean;
  warnings: IntegrationDependencyWarning[];
  coverage: IntegrationTargetCoverageSummary;
  schedule: IntegrationTargetScheduleSummary;
  lastRunDurationMs: number | null;
  consecutiveFailures: number;
  lastBlockedAt: string | null;
  hasActiveRun: boolean;
}

export interface IntegrationRemoteDocumentSummary {
  totalCount: number;
  availableCount: number;
  unavailableCount: number;
  salePdfCount: number;
  fiscalXmlCount: number;
  otherCount: number;
  lastSyncedAt: string | null;
}

export interface IntegrationReadinessSummary {
  setupStatus: IntegrationSetupStatus;
  readinessStatus: IntegrationReadinessStatus;
  capabilities: IntegrationProviderCapabilities;
  validationRequired: boolean;
  canSync: boolean;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  dependencyWarnings: IntegrationDependencyWarning[];
}

export interface IntegrationMappingValidationIssue {
  target: IntegrationSyncTarget;
  fieldId?: string;
  destinationField?: string;
  message: string;
}

export interface IntegrationMappedPreviewSample {
  externalId: string;
  label: string;
  subtitle: string | null;
  mappedPayload: Record<string, unknown>;
  issues: string[];
}

export interface IntegrationValidationResult {
  ok: boolean;
  provider: IntegrationProvider;
  status: "connected" | "action_required" | "failed";
  message: string | null;
  details?: Record<string, unknown>;
}

export interface RemoteEntityRef {
  remoteEntityId: string | null;
  remoteDisplayId?: string | null;
  remoteEntityType?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface IntegrationSyncCursor {
  cursorType: string;
  lastRemoteUpdatedAt: string | null;
  lastSuccessfulPollAt: string | null;
  nextPage: number | null;
  state: Record<string, unknown> | null;
}

export interface RemoteStatusPollResult {
  processedCount: number;
  updatedCount: number;
  cursor: IntegrationSyncCursor;
  warnings: string[];
}

export interface FinancialErpAdapter {
  provider: IntegrationProvider;
  validateConnection(): Promise<IntegrationValidationResult>;
  upsertCustomer(payload: IntegrationCustomerPayload): Promise<RemoteEntityRef>;
  upsertPessoa?(payload: IntegrationPessoaPayload): Promise<RemoteEntityRef>;
  upsertSupplier?(
    payload: IntegrationSupplierPayload,
  ): Promise<RemoteEntityRef>;
  upsertTransporter?(
    payload: IntegrationTransporterPayload,
  ): Promise<RemoteEntityRef>;
  upsertCatalogItem?(
    payload: IntegrationCatalogItemPayload,
  ): Promise<RemoteEntityRef>;
  exportBudget?(payload: IntegrationBudgetPayload): Promise<RemoteEntityRef>;
  exportSale?(payload: IntegrationSalePayload): Promise<RemoteEntityRef>;
  exportBillingDocument(
    payload: IntegrationBillingDocumentPayload,
  ): Promise<RemoteEntityRef>;
  exportPayable?(payload: IntegrationPayablePayload): Promise<RemoteEntityRef>;
  upsertContract?(
    payload: IntegrationContractPayload,
  ): Promise<RemoteEntityRef>;
  listReferenceData?(
    domain: ContaAzulReferenceDomain,
  ): Promise<ContaAzulReferencePage>;
  pollBillingStatus?(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult>;
  pollPayableStatus?(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult>;
  pollFiscalDocuments?(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult>;
  pollProtocols?(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult>;
  linkFiscalDocumentsToMdfe?(
    payload: IntegrationMdfeLinkPayload,
  ): Promise<RemoteEntityRef>;
  pollRemoteDrift?(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult>;
  /** Read the ERP on-hand stock for a linked product (materials mirror). */
  fetchProductStock?(
    remoteEntityId: string,
  ): Promise<{ quantity: number | null }>;
  /**
   * Set the ERP product's absolute on-hand quantity (entrada/ajuste — the
   * ERP records a movement equal to the difference). Never called by
   * catalog upserts; only by the explicit stock-adjust action.
   */
  setProductStock?(remoteEntityId: string, quantity: number): Promise<void>;
}

export interface FinancialErpAdapterContext {
  integrationId: string;
  organizationId: string;
  config: FinancialErpConnectionConfig;
}

export interface FinancialErpAdapterFactory {
  createAdapter(context: FinancialErpAdapterContext): FinancialErpAdapter;
}

export const INTEGRATION_CANONICAL_FIELDS: Record<
  IntegrationSyncTarget,
  readonly string[]
> = {
  customer: [
    "externalId",
    "organizationId",
    "name",
    "taxId",
    "email",
    "phone",
    "address",
    "createdAt",
    "updatedAt",
  ],
  supplier: [
    "externalId",
    "organizationId",
    "name",
    "taxId",
    "email",
    "phone",
    "address",
    "createdAt",
    "updatedAt",
  ],
  transporter: [
    "externalId",
    "organizationId",
    "name",
    "taxId",
    "email",
    "phone",
    "address",
    "createdAt",
    "updatedAt",
  ],
  service_order: [
    "externalId",
    "organizationId",
    "unitId",
    "unitName",
    "jobId",
    "status",
    "customerExternalId",
    "customerName",
    "assetName",
    "assetTag",
    "serviceName",
    "servicePriceCents",
    "currency",
    "performedAt",
    "approvedAt",
    "updatedAt",
  ],
  catalog_item: [
    "externalId",
    "organizationId",
    "kind",
    "code",
    "name",
    "description",
    "priceCents",
    "currency",
    "unitOfMeasureId",
    "categoryId",
    "fiscalMetadata",
    "active",
  ],
  contract: [
    "externalId",
    "organizationId",
    "customerExternalId",
    "contractNumber",
    "recurrence",
    "issueDate",
    "startsAt",
    "endsAt",
    "sellerExternalId",
    "totalCents",
    "currency",
    "categoryId",
    "costCenterId",
    "notes",
    "items",
    "paymentTerms",
  ],
  billing_document: [
    "externalId",
    "documentNumber",
    "organizationId",
    "unitId",
    "unitName",
    "customerExternalId",
    "customerName",
    "totalCents",
    "currency",
    "issueDate",
    "dueDate",
    "status",
    "items",
  ],
  payable: [
    "externalId",
    "organizationId",
    "supplierExternalId",
    "documentNumber",
    "issueDate",
    "dueDate",
    "competenceDate",
    "amountCents",
    "currency",
    "categoryId",
    "costCenterId",
    "notes",
  ],
};

export const INTEGRATION_REQUIRED_DESTINATION_FIELDS: Record<
  IntegrationSyncTarget,
  readonly string[]
> = {
  catalog_item: ["externalId", "kind", "name"],
  contract: ["externalId", "customerExternalId", "totalCents"],
  customer: ["externalId", "name"],
  supplier: ["externalId", "name"],
  transporter: ["externalId", "name"],
  service_order: ["externalId", "jobId", "status"],
  billing_document: ["externalId", "totalCents", "currency", "status"],
  payable: ["externalId", "supplierExternalId", "amountCents", "dueDate"],
};

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  const numbers = parts.map((part) => Number(part));
  if (
    numbers.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255 ||
        (parts[index] ?? "").trim() === "",
    )
  ) {
    return null;
  }

  return numbers;
}

function isUnsafeIpv4Address(parts: number[]) {
  const [a = -1, b = -1] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isUnsafeIpv6Address(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (normalized === "::1" || normalized === "::") {
    return true;
  }

  if (/^fe[89ab]/i.test(normalized)) {
    return true;
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

export function normalizeIntegrationBaseUrl(baseUrl: string): string {
  let url: URL;

  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error("Base URL inválida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL deve usar http ou https");
  }

  if (url.username || url.password) {
    throw new Error("Base URL não pode incluir credenciais embutidas");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new Error("Base URL inválida");
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Base URL não pode apontar para loopback ou localhost");
  }

  const ipv4 = parseIpv4Address(hostname);
  if (ipv4 && isUnsafeIpv4Address(ipv4)) {
    throw new Error("Base URL não pode apontar para endereços privados");
  }

  if (hostname.includes(":") && isUnsafeIpv6Address(hostname)) {
    throw new Error("Base URL não pode apontar para endereços privados");
  }

  if (url.search || url.hash) {
    throw new Error("Base URL não pode incluir query string ou fragmento");
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${normalizedPath}`;
}

export type IntegrationCustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
  country?: string;
} | null;

export function formatIntegrationCustomerAddress(
  address: IntegrationCustomerAddress,
): string | null {
  if (!address || typeof address !== "object") return null;

  const parts = [
    address.street,
    address.number,
    address.complement,
    address.neighbourhood,
    address.city,
    address.state,
    address.cep,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  return parts.length > 0 ? parts.join(", ") : null;
}

function defaultMappingRules(
  target: IntegrationSyncTarget,
): IntegrationFieldMappingRule[] {
  return INTEGRATION_CANONICAL_FIELDS[target].map((field) => ({
    id: `${target}:${field}`,
    destinationField: field,
    enabled: true,
    valueMode: "source",
    sourceField: field,
    constantValue: null,
    formatter: "none",
  }));
}

function normalizePath(path: string, fallback: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (!trimmed) return fallback;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeScheduleConfig(
  input?: Partial<IntegrationTargetScheduleConfig> | null,
): IntegrationTargetScheduleConfig {
  const mode =
    input?.mode === "disabled" ||
    input?.mode === "manual_only" ||
    input?.mode === "scheduled"
      ? input.mode
      : "manual_only";
  const frequency =
    input?.frequency === "weekly" || input?.frequency === "daily"
      ? input.frequency
      : DEFAULT_INTEGRATION_SCHEDULE_FREQUENCY;

  return {
    mode,
    frequency,
    nextScheduledRunAt: input?.nextScheduledRunAt ?? null,
    lastScheduledRunAt: input?.lastScheduledRunAt ?? null,
  };
}

function normalizeSchedulesConfig(
  input?: Partial<
    Record<IntegrationSyncTarget, Partial<IntegrationTargetScheduleConfig>>
  > | null,
): Record<IntegrationSyncTarget, IntegrationTargetScheduleConfig> {
  return {
    catalog_item: normalizeScheduleConfig(input?.catalog_item),
    contract: normalizeScheduleConfig(input?.contract),
    customer: normalizeScheduleConfig(input?.customer),
    supplier: normalizeScheduleConfig(input?.supplier),
    transporter: normalizeScheduleConfig(input?.transporter),
    service_order: normalizeScheduleConfig(input?.service_order),
    billing_document: normalizeScheduleConfig(input?.billing_document),
    payable: normalizeScheduleConfig(input?.payable),
  };
}

function normalizeMappingRule(
  rule: Partial<IntegrationFieldMappingRule> | undefined,
  fallbackId: string,
): IntegrationFieldMappingRule {
  const valueMode =
    rule?.valueMode === "constant" || rule?.valueMode === "source"
      ? rule.valueMode
      : "source";

  return {
    id: typeof rule?.id === "string" && rule.id.trim() ? rule.id : fallbackId,
    destinationField:
      typeof rule?.destinationField === "string"
        ? rule.destinationField.trim()
        : "",
    enabled: rule?.enabled ?? true,
    valueMode,
    sourceField:
      typeof rule?.sourceField === "string" && rule.sourceField.trim()
        ? rule.sourceField.trim()
        : null,
    constantValue:
      rule?.constantValue === undefined || rule?.constantValue === null
        ? null
        : String(rule.constantValue),
    formatter:
      rule?.formatter === "string" ||
      rule?.formatter === "number" ||
      rule?.formatter === "boolean" ||
      rule?.formatter === "upper_case" ||
      rule?.formatter === "lower_case" ||
      rule?.formatter === "digits_only" ||
      rule?.formatter === "date_only" ||
      rule?.formatter === "iso_datetime" ||
      rule?.formatter === "currency_major"
        ? rule.formatter
        : "none",
  };
}

function normalizeTargetMappingConfig(
  target: IntegrationSyncTarget,
  input?: Partial<IntegrationTargetMappingConfig> | null,
): IntegrationTargetMappingConfig {
  const fallback = defaultMappingRules(target);
  const normalizedFields =
    input?.fields?.map((rule, index) =>
      normalizeMappingRule(
        rule,
        fallback[index]?.id ?? `${target}:field:${index}`,
      ),
    ) ?? fallback;

  return {
    fields:
      normalizedFields.length > 0
        ? normalizedFields
        : defaultMappingRules(target),
  };
}

export function getDefaultIntegrationMappings(): IntegrationMappingsConfig {
  return {
    catalog_item: normalizeTargetMappingConfig("catalog_item"),
    contract: normalizeTargetMappingConfig("contract"),
    customer: normalizeTargetMappingConfig("customer"),
    supplier: normalizeTargetMappingConfig("supplier"),
    transporter: normalizeTargetMappingConfig("transporter"),
    service_order: normalizeTargetMappingConfig("service_order"),
    billing_document: normalizeTargetMappingConfig("billing_document"),
    payable: normalizeTargetMappingConfig("payable"),
  };
}

export function normalizeGenericFinancialErpConfig(input: {
  baseUrl: string;
  healthPath?: string;
  customerPath?: string;
  serviceOrderPath?: string;
  billingDocumentPath?: string;
  schedules?: Partial<
    Record<IntegrationSyncTarget, Partial<IntegrationTargetScheduleConfig>>
  >;
  mappings?: Partial<
    Record<IntegrationSyncTarget, Partial<IntegrationTargetMappingConfig>>
  >;
}): GenericFinancialErpConnectionConfig {
  const trimmedBaseUrl = normalizeIntegrationBaseUrl(input.baseUrl);

  return {
    baseUrl: trimmedBaseUrl,
    healthPath: normalizePath(
      input.healthPath ?? "",
      DEFAULT_GENERIC_ERP_PATHS.health,
    ),
    customerPath: normalizePath(
      input.customerPath ?? "",
      DEFAULT_GENERIC_ERP_PATHS.customers,
    ),
    serviceOrderPath: normalizePath(
      input.serviceOrderPath ?? "",
      DEFAULT_GENERIC_ERP_PATHS.serviceOrders,
    ),
    billingDocumentPath: normalizePath(
      input.billingDocumentPath ?? "",
      DEFAULT_GENERIC_ERP_PATHS.billingDocuments,
    ),
    authType: "bearer",
    schedules: normalizeSchedulesConfig(input.schedules),
    mappings: {
      catalog_item: normalizeTargetMappingConfig(
        "catalog_item",
        input.mappings?.catalog_item,
      ),
      contract: normalizeTargetMappingConfig(
        "contract",
        input.mappings?.contract,
      ),
      customer: normalizeTargetMappingConfig(
        "customer",
        input.mappings?.customer,
      ),
      supplier: normalizeTargetMappingConfig(
        "supplier",
        input.mappings?.supplier,
      ),
      transporter: normalizeTargetMappingConfig(
        "transporter",
        input.mappings?.transporter,
      ),
      service_order: normalizeTargetMappingConfig(
        "service_order",
        input.mappings?.service_order,
      ),
      billing_document: normalizeTargetMappingConfig(
        "billing_document",
        input.mappings?.billing_document,
      ),
      payable: normalizeTargetMappingConfig("payable", input.mappings?.payable),
    },
  };
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeStringArray(value: unknown, fallback: readonly string[]) {
  if (!Array.isArray(value)) return [...fallback];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeNullableRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value).filter(
    ([key]) => key.trim().length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeContaAzulExportMode(value: unknown): ContaAzulExportMode {
  switch (value) {
    case "budget_to_sale":
    case "contract_generated":
    case "receivable_event":
    case "sale":
    case "sale_and_receivable":
      return value;
    default:
      return "receivable_event";
  }
}

function normalizeContaAzulBudgetMode(_value: unknown): ContaAzulBudgetMode {
  return "sales_search_link";
}

function normalizeContaAzulFiscalMode(value: unknown): ContaAzulFiscalMode {
  switch (value) {
    case "disabled":
      return value;
    default:
      return "consultation_only";
  }
}

function normalizeContaAzulProtocolMode(value: unknown): ContaAzulProtocolMode {
  return value === "metadata_only" ? value : "api_lookup_verified";
}

function normalizeContaAzulSaleTrigger(value: unknown): ContaAzulSaleTrigger {
  switch (value) {
    case "billing_document_issued":
    case "certificate_approved":
    case "quote_approved":
    case "service_order_approved":
    case "service_order_completed":
      return value;
    default:
      return "manual";
  }
}

function normalizeContaAzulEnabledTargets(
  input?: Partial<ContaAzulEnabledTargetsConfig> | null,
): ContaAzulEnabledTargetsConfig {
  return {
    customers: input?.customers ?? true,
    suppliers: input?.suppliers ?? false,
    transporters: input?.transporters ?? false,
    services: input?.services ?? false,
    products: input?.products ?? false,
    inventoryTaxonomy: input?.inventoryTaxonomy ?? false,
    budgets: input?.budgets ?? false,
    sellers: input?.sellers ?? true,
    sales: input?.sales ?? false,
    contracts: input?.contracts ?? false,
    billingDocuments: input?.billingDocuments ?? true,
    receivables: input?.receivables ?? true,
    payables: input?.payables ?? false,
    expenses: input?.expenses ?? false,
    financialAccounts: input?.financialAccounts ?? true,
    balances: input?.balances ?? false,
    transfers: input?.transfers ?? false,
    categories: input?.categories ?? true,
    dreCategories: input?.dreCategories ?? false,
    costCenters: input?.costCenters ?? true,
    baixas: input?.baixas ?? true,
    paymentStatusPolling: input?.paymentStatusPolling ?? true,
    fiscalDocuments: input?.fiscalDocuments ?? false,
    remoteDocuments: input?.remoteDocuments ?? false,
    protocols: input?.protocols ?? false,
    driftChecks: input?.driftChecks ?? false,
  };
}

function normalizeContaAzulBaseUrl(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return CONTA_AZUL_API_BASE_URL;
  }

  if (value !== CONTA_AZUL_API_BASE_URL) {
    throw new Error("Base URL da Conta Azul deve usar o endpoint oficial");
  }

  return CONTA_AZUL_API_BASE_URL;
}

export function normalizeContaAzulConnectionConfig(
  input: ContaAzulConnectionConfigInput = {},
): ContaAzulConnectionConfig {
  return {
    provider: "conta_azul",
    baseUrl: normalizeContaAzulBaseUrl(input.baseUrl),
    accountId: normalizeNullableText(input.accountId),
    connectedCompanyName: normalizeNullableText(input.connectedCompanyName),
    scopes: normalizeStringArray(input.scopes, DEFAULT_CONTA_AZUL_SCOPES),
    accessTokenExpiresAt: normalizeNullableText(input.accessTokenExpiresAt),
    defaultFinancialAccountId: normalizeNullableText(
      input.defaultFinancialAccountId,
    ),
    defaultCategoryId: normalizeNullableText(input.defaultCategoryId),
    defaultCostCenterId: normalizeNullableText(input.defaultCostCenterId),
    defaultDreCategoryId: normalizeNullableText(input.defaultDreCategoryId),
    defaultExpenseCategoryId: normalizeNullableText(
      input.defaultExpenseCategoryId,
    ),
    defaultPaymentMethodId: normalizeNullableText(input.defaultPaymentMethodId),
    defaultProductCategoryId: normalizeNullableText(
      input.defaultProductCategoryId,
    ),
    defaultSellerId: normalizeNullableText(input.defaultSellerId),
    defaultServiceCategoryId: normalizeNullableText(
      input.defaultServiceCategoryId,
    ),
    defaultUnitOfMeasureId: normalizeNullableText(input.defaultUnitOfMeasureId),
    budgetMode: normalizeContaAzulBudgetMode(input.budgetMode),
    fiscalMode: normalizeContaAzulFiscalMode(input.fiscalMode),
    defaultFiscalTaxonomy: normalizeNullableRecord(input.defaultFiscalTaxonomy),
    protocolMode: normalizeContaAzulProtocolMode(input.protocolMode),
    saleTrigger: normalizeContaAzulSaleTrigger(input.saleTrigger),
    exportMode: normalizeContaAzulExportMode(input.exportMode),
    enabledTargets: normalizeContaAzulEnabledTargets(input.enabledTargets),
    polling: {
      receivablesLastRemoteUpdatedAt: normalizeNullableText(
        input.polling?.receivablesLastRemoteUpdatedAt,
      ),
      payablesLastRemoteUpdatedAt: normalizeNullableText(
        input.polling?.payablesLastRemoteUpdatedAt,
      ),
      invoicesLastRemoteUpdatedAt: normalizeNullableText(
        input.polling?.invoicesLastRemoteUpdatedAt,
      ),
      protocolsLastRemoteUpdatedAt: normalizeNullableText(
        input.polling?.protocolsLastRemoteUpdatedAt,
      ),
      driftLastCheckedAt: normalizeNullableText(
        input.polling?.driftLastCheckedAt,
      ),
    },
    schedules: normalizeSchedulesConfig(input.schedules),
    mappings: {
      catalog_item: normalizeTargetMappingConfig(
        "catalog_item",
        input.mappings?.catalog_item,
      ),
      contract: normalizeTargetMappingConfig(
        "contract",
        input.mappings?.contract,
      ),
      customer: normalizeTargetMappingConfig(
        "customer",
        input.mappings?.customer,
      ),
      supplier: normalizeTargetMappingConfig(
        "supplier",
        input.mappings?.supplier,
      ),
      transporter: normalizeTargetMappingConfig(
        "transporter",
        input.mappings?.transporter,
      ),
      service_order: normalizeTargetMappingConfig(
        "service_order",
        input.mappings?.service_order,
      ),
      billing_document: normalizeTargetMappingConfig(
        "billing_document",
        input.mappings?.billing_document,
      ),
      payable: normalizeTargetMappingConfig("payable", input.mappings?.payable),
    },
  };
}

export function normalizeFinancialErpConnectionConfig(
  provider: IntegrationProvider,
  input: ContaAzulConnectionConfigInput &
    Partial<GenericFinancialErpConnectionConfig> & { baseUrl?: string },
): FinancialErpConnectionConfig {
  if (provider === "conta_azul") {
    return normalizeContaAzulConnectionConfig(input);
  }

  return normalizeGenericFinancialErpConfig({
    ...input,
    baseUrl: input.baseUrl ?? "",
  });
}

export function validateIntegrationMappings(
  mappings: IntegrationMappingsConfig,
): IntegrationMappingValidationIssue[] {
  const issues: IntegrationMappingValidationIssue[] = [];

  for (const target of INTEGRATION_SYNC_TARGETS) {
    const config = mappings[target];
    const seenDestinations = new Set<string>();

    for (const field of config.fields) {
      if (!field.enabled) {
        continue;
      }

      if (!field.destinationField.trim()) {
        issues.push({
          target,
          fieldId: field.id,
          message: "Destino é obrigatório.",
        });
        continue;
      }

      const normalizedDestination = field.destinationField.trim();
      if (seenDestinations.has(normalizedDestination)) {
        issues.push({
          target,
          fieldId: field.id,
          destinationField: normalizedDestination,
          message: `Destino duplicado: ${normalizedDestination}.`,
        });
      }
      seenDestinations.add(normalizedDestination);

      if (field.valueMode === "source") {
        if (!field.sourceField) {
          issues.push({
            target,
            fieldId: field.id,
            destinationField: normalizedDestination,
            message: `Selecione um campo de origem para ${normalizedDestination}.`,
          });
          continue;
        }

        if (!INTEGRATION_CANONICAL_FIELDS[target].includes(field.sourceField)) {
          issues.push({
            target,
            fieldId: field.id,
            destinationField: normalizedDestination,
            message: `Campo de origem inválido: ${field.sourceField}.`,
          });
        }
      } else if (field.constantValue === null) {
        issues.push({
          target,
          fieldId: field.id,
          destinationField: normalizedDestination,
          message: `Informe um valor constante para ${normalizedDestination}.`,
        });
      }
    }

    for (const requiredField of INTEGRATION_REQUIRED_DESTINATION_FIELDS[
      target
    ]) {
      const enabledRule = config.fields.find(
        (field) =>
          field.enabled && field.destinationField.trim() === requiredField,
      );

      if (!enabledRule) {
        issues.push({
          target,
          destinationField: requiredField,
          message: `Campo obrigatório ausente: ${requiredField}.`,
        });
      }
    }
  }

  return issues;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;
  return null;
}

function formatMappingValue(
  value: unknown,
  formatter: IntegrationMappingFormatter,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (formatter) {
    case "none":
      return value;
    case "string":
      return String(value);
    case "number": {
      const parsed =
        typeof value === "number" ? value : Number.parseFloat(String(value));
      return Number.isFinite(parsed) ? parsed : value;
    }
    case "boolean": {
      const parsed = parseBoolean(value);
      return parsed === null ? value : parsed;
    }
    case "upper_case":
      return String(value).toUpperCase();
    case "lower_case":
      return String(value).toLowerCase();
    case "digits_only":
      return String(value).replace(/\D+/g, "");
    case "date_only": {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime())
        ? value
        : parsed.toISOString().slice(0, 10);
    }
    case "iso_datetime": {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }
    case "currency_major": {
      const parsed =
        typeof value === "number" ? value : Number.parseFloat(String(value));
      return Number.isFinite(parsed) ? Math.round(parsed) / 100 : value;
    }
  }
}

export function applyIntegrationMappings(
  target: IntegrationSyncTarget,
  payload: Record<string, unknown>,
  mapping: IntegrationTargetMappingConfig,
): {
  mappedPayload: Record<string, unknown>;
  issues: string[];
} {
  const mappedPayload: Record<string, unknown> = {};
  const issues: string[] = [];

  for (const field of mapping.fields) {
    if (!field.enabled) continue;

    const destinationField = field.destinationField.trim();
    if (!destinationField) continue;

    const rawValue =
      field.valueMode === "source"
        ? field.sourceField
          ? payload[field.sourceField]
          : null
        : field.constantValue;
    const formattedValue = formatMappingValue(rawValue, field.formatter);

    mappedPayload[destinationField] = formattedValue;
  }

  for (const requiredField of INTEGRATION_REQUIRED_DESTINATION_FIELDS[target]) {
    const value = mappedPayload[requiredField];
    const missing =
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim().length === 0);

    if (missing) {
      issues.push(`Campo obrigatório sem valor: ${requiredField}.`);
    }
  }

  return { mappedPayload, issues };
}
