import { integrationEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The ERP integrations client is its endpoint group (`integrationEndpoints` in `@calibra-facil/contracts`). */
export type IntegrationsApi = EndpointClient<typeof integrationEndpoints>;

export function createIntegrationsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): IntegrationsApi {
  return endpointClient(integrationEndpoints, transport, options);
}
