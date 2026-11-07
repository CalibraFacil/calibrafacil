import {
  environmentalLimitEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The environmental-limits client is its endpoint group (`environmentalLimitEndpoints` in `@calibra-facil/contracts`). */
export type EnvironmentalLimitsApi = EndpointClient<
  typeof environmentalLimitEndpoints
>;

export function createEnvironmentalLimitsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): EnvironmentalLimitsApi {
  return endpointClient(environmentalLimitEndpoints, transport, options);
}
