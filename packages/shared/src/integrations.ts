export type IntegrationType = "financial_erp";

export type IntegrationProvider = "generic_http";

export type IntegrationStatus = "ACTIVE" | "DISABLED";

export type IntegrationSetupStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "READY"
  | "ACTION_REQUIRED";

export type IntegrationReadinessStatus = "NOT_READY" | "READY" | "DEGRADED";

export type IntegrationSyncTarget =
  | "customer"
  | "service_order"
  | "billing_document";

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

export type IntegrationEventLevel = "info" | "warning" | "error";

export type IntegrationCredentialType = "bearer";

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
  | "CUSTOMERS_NOT_SYNCED"
  | "SERVICE_ORDERS_NOT_SYNCED"
  | "VALIDATION_REQUIRED"
  | "INTEGRATION_DISABLED";

export const DEFAULT_GENERIC_ERP_PATHS = {
  health: "/health",
  customers: "/customers",
  serviceOrders: "/service-orders",
  billingDocuments: "/billing-documents",
} as const;

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

export interface IntegrationCustomerPayload {
  externalId: string;
  organizationId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
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

export interface IntegrationReadinessSummary {
  setupStatus: IntegrationSetupStatus;
  readinessStatus: IntegrationReadinessStatus;
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
};

export const INTEGRATION_REQUIRED_DESTINATION_FIELDS: Record<
  IntegrationSyncTarget,
  readonly string[]
> = {
  customer: ["externalId", "name"],
  service_order: ["externalId", "jobId", "status"],
  billing_document: ["externalId", "totalCents", "currency", "status"],
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

type IntegrationCustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
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
    customer: normalizeTargetMappingConfig("customer"),
    service_order: normalizeTargetMappingConfig("service_order"),
    billing_document: normalizeTargetMappingConfig("billing_document"),
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
    schedules: {
      customer: normalizeScheduleConfig(input.schedules?.customer),
      service_order: normalizeScheduleConfig(input.schedules?.service_order),
      billing_document: normalizeScheduleConfig(
        input.schedules?.billing_document,
      ),
    },
    mappings: {
      customer: normalizeTargetMappingConfig(
        "customer",
        input.mappings?.customer,
      ),
      service_order: normalizeTargetMappingConfig(
        "service_order",
        input.mappings?.service_order,
      ),
      billing_document: normalizeTargetMappingConfig(
        "billing_document",
        input.mappings?.billing_document,
      ),
    },
  };
}

export function validateIntegrationMappings(
  mappings: IntegrationMappingsConfig,
): IntegrationMappingValidationIssue[] {
  const issues: IntegrationMappingValidationIssue[] = [];

  for (const target of Object.keys(mappings) as IntegrationSyncTarget[]) {
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
