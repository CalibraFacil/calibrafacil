import {
  financeEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The finance client is its endpoint group (`financeEndpoints` in `@calibra-facil/contracts`). */
export type FinanceApi = EndpointClient<typeof financeEndpoints>;

export function createFinanceApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): FinanceApi {
  return endpointClient(financeEndpoints, transport, options);
}
