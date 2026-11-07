import {
  accreditedScopeEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The accredited-scope client is its endpoint group (`accreditedScopeEndpoints` in `@calibra-facil/contracts`). */
export type AccreditedScopeApi = EndpointClient<
  typeof accreditedScopeEndpoints
>;

export function createAccreditedScopeApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): AccreditedScopeApi {
  return endpointClient(accreditedScopeEndpoints, transport, options);
}
