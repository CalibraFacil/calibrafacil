import {
  capaEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The CAPA client is its endpoint group (`capaEndpoints` in `@calibra-facil/contracts`). */
export type CapasApi = EndpointClient<typeof capaEndpoints>;

export function createCapasApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): CapasApi {
  return endpointClient(capaEndpoints, transport, options);
}
