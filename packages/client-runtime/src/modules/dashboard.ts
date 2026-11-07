import { dashboardEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The dashboard client is its endpoint group (`dashboardEndpoints` in `@calibra-facil/contracts`). */
export type DashboardApi = EndpointClient<typeof dashboardEndpoints>;

export function createDashboardApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): DashboardApi {
  return endpointClient(dashboardEndpoints, transport, options);
}
