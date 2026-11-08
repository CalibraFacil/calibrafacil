import { invalid } from "../../lib/domain-errors";

/** A numeric route identifier, or a 400 for an unreadable one. */
export function requireRouteId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw invalid("invalid_request", "ID invalido");
  return id;
}
