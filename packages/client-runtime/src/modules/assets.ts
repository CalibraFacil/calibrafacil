import {
  assetEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The assets client is its endpoint group (`assetEndpoints` in `@calibra-facil/contracts`). */
export type AssetsApi = EndpointClient<typeof assetEndpoints>;

export function createAssetsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): AssetsApi {
  return endpointClient(assetEndpoints, transport, options);
}
