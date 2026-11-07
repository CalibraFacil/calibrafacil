import {
  competenceEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The competences client is its endpoint group (`competenceEndpoints` in `@calibra-facil/contracts`). */
export type CompetencesApi = EndpointClient<typeof competenceEndpoints>;

export function createCompetencesApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): CompetencesApi {
  return endpointClient(competenceEndpoints, transport, options);
}
