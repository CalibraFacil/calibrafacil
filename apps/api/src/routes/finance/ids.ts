import { invalid } from "../../lib/domain-errors";

/** The positive integer a finance route parameter names; throws 400 when it is not one. */
export function requirePositiveRouteId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw invalid("invalid_request", "ID inválido");
  }
  return id;
}
