type ExecuteResultWithRows<T> = {
  rows: T[];
};

function hasRows<T>(value: unknown): value is ExecuteResultWithRows<T> {
  if (typeof value !== "object" || value === null || !("rows" in value)) {
    return false;
  }

  const rows = Object.fromEntries(Object.entries(value)).rows;
  return (
    Array.isArray(rows)
  );
}

export function getExecuteRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- callers provide the SQL row shape for untyped driver execute results.
    return result as T[];
  }

  if (hasRows<T>(result)) {
    return result.rows;
  }

  return [];
}
