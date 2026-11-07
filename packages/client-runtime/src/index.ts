import type { CalibraApi } from "./types";
import type { CreateCloudApiClientOptions } from "./transport/cloud";
import {
  createCloudEndpointTransport,
  endpointClients,
} from "./transport/endpoint-client";
import type { CreateDesktopHybridApiClientOptions } from "./transport/desktop";
import {
  composeDesktopHybridApi,
  createDesktopApiClient,
  createDesktopBackgroundSyncRequester,
} from "./transport/desktop-client";
import { ENDPOINT_GROUPS } from "@calibra-facil/contracts";
import { createCloudAttachmentsApi } from "./modules/attachments";
import { createCloudSyncApi } from "./modules/sync";
import { createCustomersApi } from "./modules/customers";
import { createEntityLabelsApi } from "./modules/entity-labels";
import { createEnvironmentalLimitsApi } from "./modules/environmental-limits";
import { createJobsApi } from "./modules/jobs";
import { createLabSetupApi } from "./modules/lab-setup";
import { createMethodsApi } from "./modules/methods";
import { createOrganizationMediaApi } from "./modules/organization-media";
import { createProfileMediaApi } from "./modules/profile-media";
import { createServiceOrdersApi } from "./modules/service-orders";
import { createSignaturesApi } from "./modules/signatures";
import { createStandardsApi } from "./modules/standards";
import { createUnitsApi } from "./modules/units";

export type { CreateCloudApiClientOptions } from "./transport/cloud";
export type { CreateDesktopHybridApiClientOptions } from "./transport/desktop";
export { isDesktopRuntime } from "./transport/desktop";
export { createDesktopApiClient } from "./transport/desktop-client";

export * from "./types";
export * from "./data-policy";
export * from "./availability";
export function createCloudApiClient(
  options: CreateCloudApiClientOptions,
): CalibraApi {
  const transport = createCloudEndpointTransport(options);

  return {
    // Every endpoint group is its own client...
    ...endpointClients(ENDPOINT_GROUPS, transport, options),
    // ...except where the client adds logic of its own.
    customers: createCustomersApi(transport, options),
    units: createUnitsApi(transport, options),
    jobs: createJobsApi(transport, options),
    environmentalLimits: createEnvironmentalLimitsApi(transport, options),
    entityLabels: createEntityLabelsApi(transport, options),
    labSetup: createLabSetupApi(transport, options),
    methods: createMethodsApi(transport, options),
    serviceOrders: createServiceOrdersApi(transport, options),
    signatures: createSignaturesApi(transport, options),
    profileMedia: createProfileMediaApi(transport, options),
    organizationMedia: createOrganizationMediaApi(transport, options),
    standards: createStandardsApi(transport, options),
    sync: createCloudSyncApi(),
    attachments: createCloudAttachmentsApi(),
  };
}

export function createDesktopHybridApiClient(
  options: CreateDesktopHybridApiClientOptions,
): CalibraApi {
  const cloud = createCloudApiClient(options.cloud);
  const local = createDesktopApiClient(options.local);
  const requestBackgroundSync = createDesktopBackgroundSyncRequester(
    options.local,
  );

  // All cloud-vs-local routing is derived from calibraApiPolicyRegistry —
  // change a method's policy there and the hybrid client reroutes with it.
  return composeDesktopHybridApi(cloud, local, requestBackgroundSync);
}
