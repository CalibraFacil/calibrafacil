import {
  unitEndpoints,
  type OrganizationGovernanceActivityData,
  type OrganizationGovernanceMembersData,
  type OrganizationUnitsData,
  type ResponseValidationOptions,
  type UnitsContext,
} from "@calibra-facil/contracts";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

type ReadMethod =
  | "getDashboardUnits"
  | "listAdminUnits"
  | "listAdminMembers"
  | "listAdminActivity";

/**
 * The units client is its endpoint group (`unitEndpoints` in
 * `@calibra-facil/contracts`) plus the one client-side rule: the four reads
 * answer a member without governance access (403) with an empty result, so a
 * screen renders its "no access" state instead of failing.
 */
export type UnitsApi = Omit<
  EndpointClient<typeof unitEndpoints>,
  ReadMethod
> & {
  /** The unit context of the session; null when the member may not read it (403). */
  getDashboardUnits(): Promise<UnitsContext | null>;
  listAdminUnits(): Promise<OrganizationUnitsData>;
  listAdminMembers(): Promise<OrganizationGovernanceMembersData>;
  listAdminActivity(): Promise<OrganizationGovernanceActivityData>;
};

export function createUnitsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): UnitsApi {
  const client = endpointClient(unitEndpoints, transport, options);

  return {
    ...client,
    getDashboardUnits: () =>
      orWhenForbidden(() => client.getDashboardUnits(), null),
    listAdminUnits: () =>
      orWhenForbidden(() => client.listAdminUnits(), emptyGovernanceResponse()),
    listAdminMembers: () =>
      orWhenForbidden(
        () => client.listAdminMembers(),
        emptyGovernanceResponse(),
      ),
    listAdminActivity: () =>
      orWhenForbidden(
        () => client.listAdminActivity(),
        emptyGovernanceResponse(),
      ),
  };
}

async function orWhenForbidden<TResult, TFallback>(
  call: () => Promise<TResult>,
  fallback: TFallback,
): Promise<TResult | TFallback> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CalibraApiError && error.status === 403) {
      return fallback;
    }
    throw error;
  }
}

/** What a governance read answers a member who may not see it: nothing, and no capabilities. */
export function emptyGovernanceResponse() {
  return {
    data: [],
    viewer: {
      isGlobalManager: false,
      canManageOrganizationUnits: false,
      canManageAssignments: false,
      canManageGlobalRoles: false,
      canViewGovernance: false,
      canAccessConsolidatedView: false,
      managedUnitIds: [],
    },
  };
}
