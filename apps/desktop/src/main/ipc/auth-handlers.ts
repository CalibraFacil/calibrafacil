import type {
  DesktopAuthFetchRequest,
  DesktopAuthFetchResponse,
} from "@calibra-facil/contracts";
import type { HandlersFor } from "./handler-types";

/** Cloud sign-in and API calls made on the renderer's behalf. */
export function authHandlers(deps: {
  authFetch(
    request: DesktopAuthFetchRequest,
  ): Promise<DesktopAuthFetchResponse>;
}): HandlersFor<"authFetch"> {
  return {
    authFetch: (request) => deps.authFetch(request),
  };
}
