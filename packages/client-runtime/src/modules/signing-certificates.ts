import { signingCertificateEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The signing certificates client is its endpoint group (`signingCertificateEndpoints` in `@calibra-facil/contracts`). */
export type SigningCertificatesApi = EndpointClient<
  typeof signingCertificateEndpoints
>;

export function createSigningCertificatesApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): SigningCertificatesApi {
  return endpointClient(signingCertificateEndpoints, transport, options);
}
