import { certificateNumberingEndpoints } from "./certificate-numbering";
import { customerEndpoints } from "./customers";
import { dashboardEndpoints } from "./dashboard";
import type { EndpointGroup, EndpointPaths } from "./define";
import { reportEndpoints } from "./reports";

export * from "./define";
export * from "./customers";
export * from "./dashboard";
export * from "./reports";
export * from "./certificate-numbering";

/**
 * Every converted domain, keyed by its `CalibraApi` namespace. This is the one
 * list the `AppType` route paths, the policy registry, the desktop stubs and the
 * route-drift spec read; converting a domain adds its group here.
 */
export const ENDPOINT_GROUPS = {
  customers: customerEndpoints,
  dashboard: dashboardEndpoints,
  reports: reportEndpoints,
  certificateNumbering: certificateNumberingEndpoints,
} as const satisfies Record<string, EndpointGroup>;

export type EndpointGroups = typeof ENDPOINT_GROUPS;
export type EndpointGroupPaths = EndpointPaths<EndpointGroups>;
