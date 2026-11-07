import {
  serviceEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The service-catalog client is its endpoint group (`serviceEndpoints` in `@calibra-facil/contracts`). */
export type ServicesApi = EndpointClient<typeof serviceEndpoints>;

export function createServicesApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): ServicesApi {
  return endpointClient(serviceEndpoints, transport, options);
}
