import { portalDomainEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The portal domains client is its endpoint group (`portalDomainEndpoints` in `@calibra-facil/contracts`). */
export type PortalDomainsApi = EndpointClient<typeof portalDomainEndpoints>;

export function createPortalDomainsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): PortalDomainsApi {
  return endpointClient(portalDomainEndpoints, transport, options);
}
