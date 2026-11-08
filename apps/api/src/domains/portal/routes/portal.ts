// The portal's own routes: the sign-in shell (branding, organizations) and the one router the other portal route files are mounted into.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import {
  requirePortalLabScope,
  resolvePortalLabScope,
} from "../portal-lab-scope";
import { organization } from "@calibra-facil/db/schema";
import { portalShellEndpoints } from "@calibra-facil/contracts";
import { eq } from "drizzle-orm";
import {
  requirePortalAuth,
  type AuthVariables,
} from "../../../middleware/permission";
import { type R2Env } from "../../../lib/storage";
import { listPortalClientOrganizations } from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { portalAssetsRouter } from "./portal-assets";
import { portalAuditPacksRouter } from "./portal-audit-packs";
import { portalCertificatesRouter } from "./portal-certificates";
import { portalDashboardRouter } from "./portal-dashboard";
import { portalOotNotificationsRouter } from "./portal-oot-notifications";
import { portalPreferencesRouter } from "./portal-preferences";
import { portalReliabilityRouter } from "./portal-reliability";

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /branding - Public white-label identity for the active portal host
// =========================================================================
// Unauthenticated on purpose: the sign-in page needs the lab's name + logo
// before a session exists. Resolved from the request Origin via the custom
// domain (resolvePortalLabScope). Degrades to nulls on the default portal host
// or an unrecognized domain, so the SPA falls back to CalibraFácil branding.
// =========================================================================
mount(portalRouter, PREFIX, portalShellEndpoints.branding, [], async (c) => {
  const portalLabScope = await resolvePortalLabScope(c);
  if (!portalLabScope.labOrganizationId) {
    return {
      name: null,
      logo: null,
    };
  }

  // `organization` is a global table (no policy): no transaction needed.
  const [labOrganization] = await orgDb(portalLabScope.labOrganizationId)
    .select({ name: organization.name, logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, portalLabScope.labOrganizationId))
    .limit(1);

  return {
    name: labOrganization?.name ?? null,
    logo: labOrganization?.logo ?? null,
  };
});

// =========================================================================
// GET /organizations - List CLIENT organizations for the portal
// =========================================================================
// Returns only organizations where:
// 1. The organization type is "CLIENT"
// 2. The user's role is in PORTAL_ACCESS_ROLES (external portal roles)
//
// This ensures only external portal members can access client organizations
// in the portal, regardless of internal/system ownership members.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalShellEndpoints.organizations,
  [requirePortalAuth],
  async (c) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);

    // A CLIENT org the user belongs to is either a branch customer's org or a
    // customer-group org (the consolidated "rede" view). Left-join both so a
    // group org — which has no `customer` row — is not dropped, and tag each
    // with `kind` to drive the switcher label ("unit" vs "group · consolidado").
    const clientOrganizations = await listPortalClientOrganizations({
      userId: session.user.id,
      labScope: portalLabScope,
    });

    return clientOrganizations;
  },
);

portalRouter
  .route("/", portalAssetsRouter)
  .route("/", portalAuditPacksRouter)
  .route("/", portalCertificatesRouter)
  .route("/", portalDashboardRouter)
  .route("/", portalOotNotificationsRouter)
  .route("/", portalPreferencesRouter)
  .route("/", portalReliabilityRouter);
