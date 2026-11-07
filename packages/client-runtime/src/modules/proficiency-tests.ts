import {
  proficiencyTestEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The proficiency-tests client is its endpoint group (`proficiencyTestEndpoints` in `@calibra-facil/contracts`). */
export type ProficiencyTestsApi = EndpointClient<
  typeof proficiencyTestEndpoints
>;

export function createProficiencyTestsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): ProficiencyTestsApi {
  return endpointClient(proficiencyTestEndpoints, transport, options);
}
