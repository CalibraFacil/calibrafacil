import {
  environmentalLimitEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";
import { CalibraApiError } from "../transport/errors";

/**
 * The environmental-limits client is its endpoint group
 * (`environmentalLimitEndpoints` in `@calibra-facil/contracts`), except that
 * the effective-limits lookup answers "no limits" when the API refuses it (a
 * member without access to the unit's settings still executes a job): a body
 * that breaks the contract still throws.
 */
export type EnvironmentalLimitsApi = EndpointClient<
  typeof environmentalLimitEndpoints
>;

export function createEnvironmentalLimitsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): EnvironmentalLimitsApi {
  const client = endpointClient(
    environmentalLimitEndpoints,
    transport,
    options,
  );

  return {
    ...client,
    async effective(input) {
      try {
        return await client.effective(input);
      } catch (error) {
        if (error instanceof CalibraApiError) {
          return { limits: null, source: null };
        }
        throw error;
      }
    },
  };
}
