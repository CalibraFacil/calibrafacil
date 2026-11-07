import {
  serviceOrderEndpoints,
  type EndpointClientInput,
  type ResponseValidationOptions,
  type ServiceOrderDetail,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/**
 * The service-orders client is its endpoint group (`serviceOrderEndpoints` in
 * `@calibra-facil/contracts`) plus the one thing that is client-side logic: the
 * two detail reads answer the order itself, not the `{ data }` envelope.
 */
export type ServiceOrdersApi = Omit<
  EndpointClient<typeof serviceOrderEndpoints>,
  "get" | "getByPublicId"
> & {
  get(
    input: EndpointClientInput<typeof serviceOrderEndpoints.get>,
  ): Promise<ServiceOrderDetail>;
  /**
   * Loads by the opaque publicId the lab dashboard routes with, so URLs never
   * carry the enumerable serial id; every other method keeps taking the numeric
   * id, which callers read off the loaded detail.
   */
  getByPublicId(
    input: EndpointClientInput<typeof serviceOrderEndpoints.getByPublicId>,
  ): Promise<ServiceOrderDetail>;
};

export function createServiceOrdersApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): ServiceOrdersApi {
  const client = endpointClient(serviceOrderEndpoints, transport, options);

  return {
    ...client,
    async get(input) {
      return (await client.get(input)).data;
    },
    async getByPublicId(input) {
      return (await client.getByPublicId(input)).data;
    },
  };
}
