import { CalibraApiError } from "./errors";

export async function readApiError(response: Response, fallback: string) {
  const body = await response.text();
  if (!body) return fallback;

  try {
    return apiErrorMessage(JSON.parse(body)) ?? fallback;
  } catch {
    return body;
  }
}

export async function readJsonResponse<TResponse>(
  response: Response,
  fallback: string,
  options: { allowDiagnosticsResponse?: boolean } = {},
) {
  if (response.ok) {
    return assumeClientResponse<TResponse>(await response.json());
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (options.allowDiagnosticsResponse && hasDiagnosticsPayload(payload)) {
    return assumeClientResponse<TResponse>(payload);
  }

  const message =
    typeof payload === "object" && payload !== null
      ? (apiErrorMessage(payload) ?? fallback)
      : fallback;

  throw new CalibraApiError(message, response.status, payload);
}

export async function readOptionalForbiddenResponse<TResponse>(
  response: Response,
  forbiddenValue: unknown,
  fallback: string,
) {
  if (response.status === 403) {
    return assumeClientResponse<TResponse>(forbiddenValue);
  }

  return readJsonResponse<TResponse>(response, fallback);
}

export async function readMutationResponse<TResponse>(
  response: Response,
  fallback: string,
) {
  const data = await response.json().catch(() => null);

  if (!response.ok || hasApiError(data)) {
    throw new CalibraApiError(
      apiErrorMessage(data) ?? fallback,
      response.status,
      data,
    );
  }

  return assumeClientResponse<TResponse>(data);
}

function hasApiError(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

function hasDiagnosticsPayload(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(Reflect.get(value, "diagnostics"))
  );
}

function assumeClientResponse<TResponse>(payload: unknown): TResponse {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- generic client-runtime methods expose typed API surfaces after HTTP success/error handling; response schemas are not currently available for every endpoint.
  return payload as TResponse;
}

function apiErrorMessage(value: unknown) {
  if (hasApiError(value) && typeof value.error === "string") {
    return value.error;
  }

  return undefined;
}
