function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function userCreateErrorWasDuplicate(error: unknown) {
  const errorRecord = recordFromUnknown(error);
  const body = recordFromUnknown(errorRecord.body);
  const cause = recordFromUnknown(errorRecord.cause);
  const statusCandidates = [
    errorRecord.status,
    errorRecord.statusCode,
    body.status,
    body.statusCode,
    cause.status,
    cause.statusCode,
  ];
  const status = statusCandidates.find(
    (candidate): candidate is number => typeof candidate === "number",
  );
  const message = [
    error instanceof Error ? error.message : null,
    errorRecord.message,
    errorRecord.error,
    errorRecord.code,
    body.message,
    body.error,
    body.code,
    cause.message,
    cause.error,
    cause.code,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    status === 409 ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("unique")
  );
}
