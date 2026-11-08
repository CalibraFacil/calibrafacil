import { z } from "zod";

/**
 * The rows array of a raw `execute` result, whichever shape the driver gives
 * (postgres.js: the array itself; node-postgres: `{ rows }`). Any other shape
 * throws: a driver change must fail loudly, never read as "no rows" and so as
 * "no work".
 */
function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (typeof result === "object" && result !== null && "rows" in result) {
    const rows = Reflect.get(result, "rows");
    if (Array.isArray(rows)) return rows;
  }
  throw new Error("A raw SQL execute returned a result of an unknown shape");
}

/**
 * The rows of a raw `execute` result, each parsed with `schema`: the row type
 * is what the schema proves, not what the caller claims. A row that does not
 * match throws.
 */
export function executeRows<S extends z.ZodType>(
  result: unknown,
  schema: S,
): Array<z.output<S>> {
  return rowsOf(result).map((row) => schema.parse(row));
}

/** How many rows a raw `execute` result holds (a `RETURNING` check). */
export function executeRowCount(result: unknown): number {
  return rowsOf(result).length;
}
