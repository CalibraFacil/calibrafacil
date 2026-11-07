import { publicInvitationEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The public invitations client is its endpoint group (`publicInvitationEndpoints` in `@calibra-facil/contracts`). */
export type PublicInvitationsApi = EndpointClient<
  typeof publicInvitationEndpoints
>;

export function createPublicInvitationsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): PublicInvitationsApi {
  return endpointClient(publicInvitationEndpoints, transport, options);
}
