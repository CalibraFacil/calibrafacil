import {
  nonConformanceEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The non-conformances client is its endpoint group (`nonConformanceEndpoints` in `@calibra-facil/contracts`). */
export type NonConformancesApi = EndpointClient<typeof nonConformanceEndpoints>;

export function createNonConformancesApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): NonConformancesApi {
  return endpointClient(nonConformanceEndpoints, transport, options);
}
