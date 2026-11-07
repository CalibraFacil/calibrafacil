import {
  spcEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The SPC client is its endpoint group (`spcEndpoints` in `@calibra-facil/contracts`). */
export type SpcApi = EndpointClient<typeof spcEndpoints>;

export function createSpcApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): SpcApi {
  return endpointClient(spcEndpoints, transport, options);
}
