type ExecuteResultWithRows<T> = {
  rows: T[];
};

function hasRows<T>(value: unknown): value is ExecuteResultWithRows<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "rows" in value &&
    Array.isArray((value as ExecuteResultWithRows<T>).rows)
  );
}

export function getExecuteRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (hasRows<T>(result)) {
    return result.rows;
  }

  return [];
}
