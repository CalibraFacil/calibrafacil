import {
  materialEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The materials client is its endpoint group (`materialEndpoints` in `@calibra-facil/contracts`). */
export type MaterialsApi = EndpointClient<typeof materialEndpoints>;

export function createMaterialsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): MaterialsApi {
  return endpointClient(materialEndpoints, transport, options);
}
