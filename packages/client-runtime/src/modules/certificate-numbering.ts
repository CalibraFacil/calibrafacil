import { certificateNumberingEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The certificate-numbering client is its endpoint group (`certificateNumberingEndpoints` in `@calibra-facil/contracts`). */
export type CertificateNumberingApi = EndpointClient<
  typeof certificateNumberingEndpoints
>;

export function createCertificateNumberingApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): CertificateNumberingApi {
  return endpointClient(certificateNumberingEndpoints, transport, options);
}
