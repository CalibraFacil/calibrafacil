/**
 * The API's structured log (roadmap 2 G2, review 3.6): one JSON object per line
 * on stdout (info) or stderr (warn, error), so `docker compose logs` and any log
 * shipper read the same fields. Nothing leaves the host; there is no SDK.
 *
 * New code logs through here. The older `console.*` calls are moved over as
 * their files are touched.
 */
export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null>;

export function log(level: LogLevel, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "info") console.log(line);
  else console.error(line);
}
