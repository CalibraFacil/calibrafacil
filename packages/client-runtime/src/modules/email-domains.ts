import { emailDomainEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The e-mail domains client is its endpoint group (`emailDomainEndpoints` in `@calibra-facil/contracts`). */
export type EmailDomainsApi = EndpointClient<typeof emailDomainEndpoints>;

export function createEmailDomainsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): EmailDomainsApi {
  return endpointClient(emailDomainEndpoints, transport, options);
}
