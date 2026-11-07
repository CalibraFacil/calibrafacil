import { visitEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The visit client is its endpoint group (`visitEndpoints` in `@calibra-facil/contracts`). */
export type VisitsApi = EndpointClient<typeof visitEndpoints>;

export function createVisitsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): VisitsApi {
  return endpointClient(visitEndpoints, transport, options);
}
