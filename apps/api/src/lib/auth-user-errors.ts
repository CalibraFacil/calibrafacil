function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

/**
 * Flatten what an auth error actually says.
 *
 * Better Auth reports the same conflict in several shapes depending on where it
 * was raised: a top-level `status`, an `APIError` carrying `statusCode` and a
 * `body`, or a driver error wrapped under `cause`. A classifier that reads only
 * the top level misses the other two and treats a recoverable conflict as a
 * hard failure, so every caller reads through this instead.
 */
export function authErrorSignals(error: unknown) {
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

  return { status, message };
}

export function userCreateErrorWasDuplicate(error: unknown) {
  const { status, message } = authErrorSignals(error);

  return (
    status === 409 ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("unique")
  );
}
