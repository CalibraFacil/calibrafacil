import { reportEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The consolidated reports client is its endpoint group (`reportEndpoints` in `@calibra-facil/contracts`). */
export type ReportsApi = EndpointClient<typeof reportEndpoints>;

export function createReportsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): ReportsApi {
  return endpointClient(reportEndpoints, transport, options);
}
