import { randomBytes } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  customer,
  organizationCustomDomain,
} from "@calibra-facil/db/schema";
import {
  isLocalHostname,
  normalizeHostname,
  normalizeOrigin,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import { organizationHasEntitlement } from "./organization-plan";

const DEFAULT_PORTAL_URL_PRODUCTION = "https://portal.calibrafacil.com";
const DEFAULT_PORTAL_URL_DEVELOPMENT = "http://localhost:5174";

export function buildPortalDomainVerificationHost(hostname: string): string {
  return `_calibrafacil-domain.${hostname}`;
}

export function createPortalDomainVerificationToken(): string {
  return randomBytes(24).toString("hex");
}

export function sanitizePortalHostname(input: string): string | null {
  const hostname = normalizeHostname(input);
  if (!hostname || isLocalHostname(hostname)) return null;
  return hostname;
}

export async function getOrganizationCustomDomain(organizationId: string) {
  return db.query.organizationCustomDomain.findFirst({
    where: eq(organizationCustomDomain.organizationId, organizationId),
  });
}

export async function getActivePortalDomainForOrganization(
  organizationId: string,
) {
  const record = await db.query.organizationCustomDomain.findFirst({
    where: and(
      eq(organizationCustomDomain.organizationId, organizationId),
      eq(organizationCustomDomain.isActive, true),
    ),
  });

  if (!record) return null;

  const hasCustomDomain = await organizationHasEntitlement(
    organizationId,
    "custom_domain",
  );
  if (!hasCustomDomain || !record.verifiedAt) return null;

  return record;
}

export async function getPortalBaseUrlForLabOrganization(
  organizationId: string,
): Promise<string> {
  const customDomain = await getActivePortalDomainForOrganization(
    organizationId,
  );
  if (customDomain) {
    return `https://${customDomain.hostname}`;
  }

  const configured = process.env.PORTAL_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    return appUrl
      .replace(":5173", ":5174")
      .replace("https://calibrafacil.com", DEFAULT_PORTAL_URL_PRODUCTION)
      .replace(/\/+$/, "");
  }

  return process.env.NODE_ENV === "production"
    ? DEFAULT_PORTAL_URL_PRODUCTION
    : DEFAULT_PORTAL_URL_DEVELOPMENT;
}

export async function getPortalBaseUrlForClientOrganization(
  authOrganizationId: string,
): Promise<string> {
  const linkedCustomer = await db.query.customer.findFirst({
    where: eq(customer.authOrganizationId, authOrganizationId),
  });

  if (!linkedCustomer) {
    return getPortalBaseUrlForLabOrganization(authOrganizationId);
  }

  return getPortalBaseUrlForLabOrganization(linkedCustomer.labOrganizationId);
}

export async function resolveLabOrganizationIdByPortalHostname(
  hostname: string | null,
): Promise<string | null> {
  if (!hostname) return null;

  const normalized = sanitizePortalHostname(hostname);
  if (!normalized) return null;

  const match = await db.query.organizationCustomDomain.findFirst({
    where: and(
      eq(organizationCustomDomain.hostname, normalized),
      eq(organizationCustomDomain.isActive, true),
    ),
  });

  if (!match?.organizationId || !match.verifiedAt) return null;

  const hasCustomDomain = await organizationHasEntitlement(
    match.organizationId,
    "custom_domain",
  );
  return hasCustomDomain ? match.organizationId : null;
}

export async function isAllowedPortalOrigin(origin: string): Promise<boolean> {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  const { hostname } = new URL(normalizedOrigin);
  const labOrganizationId = await resolveLabOrganizationIdByPortalHostname(
    hostname,
  );

  return Boolean(labOrganizationId);
}
