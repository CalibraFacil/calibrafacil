import { accessEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The access client is its endpoint group (`accessEndpoints` in `@calibra-facil/contracts`). */
export type AccessApi = EndpointClient<typeof accessEndpoints>;

export function createAccessApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): AccessApi {
  return endpointClient(accessEndpoints, transport, options);
}
