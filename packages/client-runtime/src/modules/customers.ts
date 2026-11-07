import {
  customerEndpoints,
  type CnpjLookupResult,
  type EndpointClientInput,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/**
 * The customers client is its endpoint group (`customerEndpoints` in
 * `@calibra-facil/contracts`) plus the one thing that is client-side logic.
 */
export type CustomersApi = Omit<
  EndpointClient<typeof customerEndpoints>,
  "lookupCnpj"
> & {
  /** Resolve a CNPJ against the Receita Federal mirrors. Resolves to null when it is not there. */
  lookupCnpj(
    input: EndpointClientInput<typeof customerEndpoints.lookupCnpj>,
  ): Promise<CnpjLookupResult | null>;
};

export function createCustomersApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): CustomersApi {
  const client = endpointClient(customerEndpoints, transport, options);

  return {
    ...client,
    async lookupCnpj(input) {
      try {
        return await client.lookupCnpj(input);
      } catch (error) {
        // A 404 means the CNPJ isn't in the Receita dump: a normal "no match",
        // not an error. Other non-2xx (422 invalid, 502 upstream) still throw.
        if (error instanceof CalibraApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  };
}
