import { organizationProfileEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The organization profile client is its endpoint group (`organizationProfileEndpoints` in `@calibra-facil/contracts`). */
export type OrganizationProfileApi = EndpointClient<
  typeof organizationProfileEndpoints
>;

export function createOrganizationProfileApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): OrganizationProfileApi {
  return endpointClient(organizationProfileEndpoints, transport, options);
}
