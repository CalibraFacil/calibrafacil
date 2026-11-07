import { notificationEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The notifications client is its endpoint group (`notificationEndpoints` in `@calibra-facil/contracts`). */
export type NotificationsApi = EndpointClient<typeof notificationEndpoints>;

export function createNotificationsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): NotificationsApi {
  return endpointClient(notificationEndpoints, transport, options);
}
