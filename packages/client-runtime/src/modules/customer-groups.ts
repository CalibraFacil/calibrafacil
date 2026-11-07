import {
  customerGroupEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/**
 * The customer-groups client is its endpoint group (`customerGroupEndpoints`
 * in `@calibra-facil/contracts`). Customer groups are a cloud-only lab feature
 * (consolidated multi-unit portal).
 */
export type CustomerGroupsApi = EndpointClient<typeof customerGroupEndpoints>;

export function createCustomerGroupsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): CustomerGroupsApi {
  return endpointClient(customerGroupEndpoints, transport, options);
}
