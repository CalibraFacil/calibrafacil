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

function normalizePath(path: string, fallback: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
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
  };
}
