import {
  entityLabelEndpoints,
  type EndpointClientInput,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/**
 * The entity-labels client is its endpoint group (`entityLabelEndpoints` in
 * `@calibra-facil/contracts`) plus the client-side rule that a record that is
 * not there (404) simply has no label: each method resolves to the label text
 * or to null.
 */
export type EntityLabelsApi = {
  [Name in keyof typeof entityLabelEndpoints]: (
    input: EndpointClientInput<(typeof entityLabelEndpoints)[Name]>,
  ) => Promise<string | null>;
};

export function createEntityLabelsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): EntityLabelsApi {
  const client = endpointClient(entityLabelEndpoints, transport, options);

  return {
    getNonConformance: (input) => labelOrNull(client.getNonConformance(input)),
    getCapa: (input) => labelOrNull(client.getCapa(input)),
    getCompetence: (input) => labelOrNull(client.getCompetence(input)),
  };
}

async function labelOrNull(
  request: Promise<{ label: string }>,
): Promise<string | null> {
  try {
    return (await request).label;
  } catch (error) {
    if (error instanceof CalibraApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
