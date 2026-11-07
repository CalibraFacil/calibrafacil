import type { ApiErrorJsonValue } from "@calibra-facil/contracts";

/**
 * A typed value as the JSON an error body carries (`legacyBody` fields that
 * predate the registry: a snapshot, a classification). Dates become ISO text and
 * `undefined` members drop out, exactly as `c.json` serialises them.
 */
export function toApiErrorJson(value: unknown): ApiErrorJsonValue {
  return JSON.parse(JSON.stringify(value ?? null));
}
