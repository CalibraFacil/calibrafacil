import { apiKeyEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The API keys client is its endpoint group (`apiKeyEndpoints` in `@calibra-facil/contracts`). */
export type ApiKeysApi = EndpointClient<typeof apiKeyEndpoints>;

export function createApiKeysApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): ApiKeysApi {
  return endpointClient(apiKeyEndpoints, transport, options);
}
