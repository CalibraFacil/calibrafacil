import { customerEndpoints } from "./customers";
import type { EndpointGroup, EndpointPaths } from "./define";

export * from "./define";
export * from "./customers";

/**
 * Every converted domain, keyed by its `CalibraApi` namespace. This is the one
 * list the `AppType` route paths, the policy registry, the desktop stubs and the
 * route-drift spec read; converting a domain adds its group here.
 */
export const ENDPOINT_GROUPS = {
  customers: customerEndpoints,
} as const satisfies Record<string, EndpointGroup>;

export type EndpointGroups = typeof ENDPOINT_GROUPS;
export type EndpointGroupPaths = EndpointPaths<EndpointGroups>;
