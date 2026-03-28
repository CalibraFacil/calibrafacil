export type IntegrationType = "financial_erp";

export type IntegrationProvider = "generic_http";

export type IntegrationStatus = "ACTIVE" | "DISABLED";

export type IntegrationSyncTarget =
  | "customer"
  | "service_order"
  | "billing_document";

export type IntegrationSyncTrigger = "manual" | "event";

export type IntegrationSyncStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL";

export type IntegrationEventLevel = "info" | "warning" | "error";

export type IntegrationCredentialType = "bearer";

export const DEFAULT_GENERIC_ERP_PATHS = {
  health: "/health",
  customers: "/customers",
  serviceOrders: "/service-orders",
  billingDocuments: "/billing-documents",
} as const;

export interface GenericFinancialErpConnectionConfig {
  baseUrl: string;
  healthPath: string;
  customerPath: string;
  serviceOrderPath: string;
  billingDocumentPath: string;
  authType: IntegrationCredentialType;
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
  organizationId: string;
  unitId: number | null;
  unitName: string | null;
  jobId: string;
  customerExternalId: string | null;
  customerName: string | null;
  serviceName: string | null;
  amountCents: number;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  status: "pending" | "ready";
}

function normalizePath(path: string, fallback: string): string {
  const trimmed = path.trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function normalizeGenericFinancialErpConfig(input: {
  baseUrl: string;
  healthPath?: string;
  customerPath?: string;
  serviceOrderPath?: string;
  billingDocumentPath?: string;
}): GenericFinancialErpConnectionConfig {
  const trimmedBaseUrl = input.baseUrl.trim().replace(/\/+$/, "");

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
  };
}
