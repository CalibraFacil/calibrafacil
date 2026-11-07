import { portalBaseUrl } from "@calibra-facil/shared/public-urls";
import { forbidden } from "../../lib/domain-errors";
import { resolveLabOrganizationIdByPortalHostname } from "../../lib/portal-domains";

function portalHostOrigin(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("origin") ?? c.req.header("referer") ?? null;
}

function isDefaultPortalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  let configuredPortalHostname: string | null = null;
  try {
    configuredPortalHostname = new URL(portalBaseUrl()).hostname.toLowerCase();
  } catch {
    configuredPortalHostname = null;
  }

  return (
    normalized === configuredPortalHostname ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.")
  );
}

export type PortalLabScope = {
  labOrganizationId: string | null;
  blocked: boolean;
};

/**
 * The laboratory a portal request is served for, learned from its host (a
 * laboratory's verified white-label domain). The platform's own portal host
 * serves every laboratory the customer belongs to (`labOrganizationId: null`);
 * any other host, or a request with no Origin/Referer, is `blocked`.
 */
export async function resolvePortalLabScope(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<PortalLabScope> {
  const origin = portalHostOrigin(c);
  if (!origin) return { labOrganizationId: null, blocked: true };

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const labOrganizationId =
      await resolveLabOrganizationIdByPortalHostname(hostname);

    if (labOrganizationId) {
      return { labOrganizationId, blocked: false };
    }

    return {
      labOrganizationId: null,
      blocked: !isDefaultPortalHostname(hostname),
    };
  } catch {
    return { labOrganizationId: null, blocked: true };
  }
}

/**
 * As `resolvePortalLabScope`, for the routes that list or change a customer's
 * records: a blocked host is refused (403) instead of reaching them.
 */
export async function requirePortalLabScope(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<string | null> {
  const scope = await resolvePortalLabScope(c);
  if (scope.blocked) {
    throw forbidden("forbidden", "Acesso nao permitido neste dominio");
  }
  return scope.labOrganizationId;
}
