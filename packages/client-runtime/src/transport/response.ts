import { CalibraApiError } from "./errors";

export async function readApiError(response: Response, fallback: string) {
  const body = await response.text();
  if (!body) return fallback;

  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? fallback;
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
    return response.json() as Promise<TResponse>;
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (
    options.allowDiagnosticsResponse &&
    typeof payload === "object" &&
    payload !== null &&
    "diagnostics" in payload &&
    Array.isArray((payload as { diagnostics?: unknown }).diagnostics)
  ) {
    return payload as TResponse;
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
    return forbiddenValue as TResponse;
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

  return data as TResponse;
}

function hasApiError(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

function apiErrorMessage(value: unknown) {
  if (hasApiError(value) && typeof value.error === "string") {
    return value.error;
  }

  return undefined;
}
