import type { ContentfulStatusCode } from "hono/utils/http-status";
import { toRecord } from "@calibra-facil/shared/record";

function isContentfulStatus(status: number): status is ContentfulStatusCode {
  return (
    Number.isInteger(status) &&
    status >= 200 &&
    status <= 599 &&
    status !== 204 &&
    status !== 205 &&
    status !== 304
  );
}

/**
 * The status a stored response is replayed with. The record keeps the status the
 * request answered (a stored 404 or 409 replays as that refusal, not as a 200).
 * Anything that is not a valid response status falls back to 200.
 */
export function toIdempotencyResponseStatus(
  status: number,
): ContentfulStatusCode | 204 {
  if (status === 204) return 204;
  return isContentfulStatus(status) ? status : 200;
}
