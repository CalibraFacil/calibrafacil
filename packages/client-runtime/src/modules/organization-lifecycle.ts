import { organizationLifecycleEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The organization lifecycle client is its endpoint group (`organizationLifecycleEndpoints` in `@calibra-facil/contracts`). */
export type OrganizationLifecycleApi = EndpointClient<
  typeof organizationLifecycleEndpoints
>;

export function createOrganizationLifecycleApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): OrganizationLifecycleApi {
  return endpointClient(organizationLifecycleEndpoints, transport, options);
}
