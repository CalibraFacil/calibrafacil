import type { Context } from "hono";
import { isRecord } from "@calibra-facil/shared/record";

// Kept apart from `endpoint-mount.ts` on purpose: the test setup files import
// this one before any spec runs, and `endpoint-mount` pulls in the permission
// middleware, which a spec that mocks it must be free to replace.

let checkInTests = false;

/**
 * Turns the response-schema check on for every mounted endpoint. The test setup
 * files call it (a spec that drifts fails where it is introduced); a
 * development server turns it on by its `NODE_ENV` binding. Production never
 * re-parses.
 */
export function checkEndpointResponses(enabled = true) {
  checkInTests = enabled;
}

export function shouldCheckResponses(c: Context) {
  if (checkInTests) return true;
  const bindings: unknown = c.env;
  return isRecord(bindings) && bindings.NODE_ENV === "development";
}
