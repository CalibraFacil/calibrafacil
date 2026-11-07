import {
  labSetupEndpoints,
  labSetupMetadataSchema,
  type LabSetupMetadata,
  type EndpointClientInput,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/**
 * The lab-setup client is its endpoint group (`labSetupEndpoints` in
 * `@calibra-facil/contracts`) plus the one thing that is client-side logic: a
 * refused token answers 400, 404 or 410 with the metadata body saying why
 * (`status`), which `get` hands back instead of throwing.
 */
export type LabSetupApi = Omit<
  EndpointClient<typeof labSetupEndpoints>,
  "get"
> & {
  get(
    input: EndpointClientInput<typeof labSetupEndpoints.get>,
  ): Promise<LabSetupMetadata>;
};

export function createLabSetupApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): LabSetupApi {
  const client = endpointClient(labSetupEndpoints, transport, options);

  return {
    ...client,
    async get(input) {
      try {
        return await client.get(input);
      } catch (error) {
        if (error instanceof CalibraApiError) {
          const refused = labSetupMetadataSchema.safeParse(error.payload);
          if (refused.success) return refused.data;
        }
        throw error;
      }
    },
  };
}
