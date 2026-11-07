import { assetTypeEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The asset-type catalog client is its endpoint group (`assetTypeEndpoints` in `@calibra-facil/contracts`). */
export type AssetTypesApi = EndpointClient<typeof assetTypeEndpoints>;

export function createAssetTypesApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): AssetTypesApi {
  return endpointClient(assetTypeEndpoints, transport, options);
}
