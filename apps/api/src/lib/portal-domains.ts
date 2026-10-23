import { readOriginsConfig } from "@calibra-facil/config";
import { randomBytes } from "node:crypto";
import { systemDb } from "@calibra-facil/db";
import { customer, organizationCustomDomain } from "@calibra-facil/db/schema";
import {
  isLocalHostname,
  normalizeHostname,
  normalizeOrigin,
} from "@calibra-facil/shared";
import { and, eq, ne } from "drizzle-orm";
import { portalBaseUrl } from "@calibra-facil/shared/public-urls";
import { orgDb } from "./org-db";

function derivePortalBaseUrlFromAppUrl(appUrl: string): string | null {
  try {
    const url = new URL(appUrl);
    const isLocalHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname);

    if (!isLocalHost) {
      // Convention: the portal lives on the "portal." subdomain of the app.
      return `${url.protocol}//portal.${url.hostname.replace(/^www\./, "")}`;
    }

    url.port = "5174";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

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
  return orgDb(organizationId).transaction(async (o) => {
    const [record] = await o
      .select()
      .from(organizationCustomDomain)
      .where(eq(organizationCustomDomain.organizationId, organizationId))
      .limit(1);
    return record;
  });
}

/**
 * Whether ANOTHER laboratory already holds this hostname. A hostname is unique
 * across the platform (it is how a request finds its laboratory), so this check
 * is cross-organization by design and cannot run through an org-bound handle:
 * it runs on the SYSTEM path (`systemDb`, the owner connection), because the
 * policy would hide the other laboratory's row from the one asking.
 */
export async function findPortalHostnameOwnedByOtherOrganization(
  hostname: string,
  organizationId: string,
) {
  return systemDb.query.organizationCustomDomain.findFirst({
    where: and(
      eq(organizationCustomDomain.hostname, hostname),
      ne(organizationCustomDomain.organizationId, organizationId),
    ),
  });
}

export async function getActivePortalDomainForOrganization(
  organizationId: string,
) {
  const record = await orgDb(organizationId).transaction(async (o) => {
    const [row] = await o
      .select()
      .from(organizationCustomDomain)
      .where(
        and(
          eq(organizationCustomDomain.organizationId, organizationId),
          eq(organizationCustomDomain.isActive, true),
        ),
      )
      .limit(1);
    return row;
  });

  if (!record?.verifiedAt) return null;

  return record;
}

export async function getPortalBaseUrlForLabOrganization(
  organizationId: string,
): Promise<string> {
  const customDomain =
    await getActivePortalDomainForOrganization(organizationId);
  if (customDomain) {
    return `https://${customDomain.hostname}`;
  }

  const origins = readOriginsConfig();
  const configured = origins.portalAppUrl;
  if (configured) return configured.replace(/\/+$/, "");

  const appUrl = origins.appUrl;
  if (appUrl) {
    const portalUrl = derivePortalBaseUrlFromAppUrl(appUrl);
    if (portalUrl) return portalUrl;
  }

  return portalBaseUrl();
}

export async function getPortalBaseUrlForClientOrganization(
  authOrganizationId: string,
): Promise<string> {
  // SYSTEM PATH: maps a CLIENT organization to the laboratory it belongs to, so
  // it runs before any laboratory can be named (see portal-customer-scope.ts).
  const linkedCustomer = await systemDb.query.customer.findFirst({
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

  // SYSTEM PATH: the host name of the request is what LEARNS the laboratory
  // (the portal white-label domain), so no laboratory is bound yet.
  const match = await systemDb.query.organizationCustomDomain.findFirst({
    where: and(
      eq(organizationCustomDomain.hostname, normalized),
      eq(organizationCustomDomain.isActive, true),
    ),
  });

  if (!match?.organizationId || !match.verifiedAt) return null;

  return match.organizationId;
}

export async function isAllowedPortalOrigin(origin: string): Promise<boolean> {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  const { hostname } = new URL(normalizedOrigin);
  const labOrganizationId =
    await resolveLabOrganizationIdByPortalHostname(hostname);

  return Boolean(labOrganizationId);
}
