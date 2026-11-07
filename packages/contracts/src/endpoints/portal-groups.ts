import {
  portalAssetEndpoints,
  portalAuditPackEndpoints,
  portalCertificateEndpoints,
  portalDashboardEndpoints,
  portalReliabilityEndpoints,
  portalShellEndpoints,
} from "./portal";
import {
  portalNotificationEndpoints,
  portalOotNotificationEndpoints,
  portalRequestEndpoints,
  portalServiceOrderEndpoints,
  portalVisitEndpoints,
} from "./portal-engagement";
import type { EndpointGroup } from "./define";

/**
 * The client portal's endpoints (`/api/portal/*`), keyed by the namespace of the
 * portal's own client (`apps/portal/src/lib/portal-api.ts`). Kept apart from
 * `ENDPOINT_GROUPS` on purpose (and in its own module, so the portal's entry
 * point `@calibra-facil/contracts/portal` does not pull the lab's endpoints in): the lab SDK, the policy registry and the desktop
 * stubs are built from that list, and none of them call the portal. The API
 * mounts these the same way (`mount`) and the route-drift spec checks them
 * beside `ENDPOINT_GROUPS`.
 */
export const PORTAL_ENDPOINT_GROUPS = {
  shell: portalShellEndpoints,
  dashboard: portalDashboardEndpoints,
  assets: portalAssetEndpoints,
  certificates: portalCertificateEndpoints,
  auditPacks: portalAuditPackEndpoints,
  reliability: portalReliabilityEndpoints,
  notifications: portalNotificationEndpoints,
  ootNotifications: portalOotNotificationEndpoints,
  visits: portalVisitEndpoints,
  requests: portalRequestEndpoints,
  serviceOrders: portalServiceOrderEndpoints,
} as const satisfies Record<string, EndpointGroup>;

export type PortalEndpointGroups = typeof PORTAL_ENDPOINT_GROUPS;
