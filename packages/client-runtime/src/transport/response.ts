import {
  validateResponsePayload,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";
import type { z } from "zod";

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

/** The JSON body of a 2xx answer; any other status is a `CalibraApiError` (the body's `error`, else `fallback`). */
export async function readJsonResponse(
  response: Response,
  fallback: string,
): Promise<unknown> {
  if (response.ok) {
    const body: unknown = await response.json();
    return body;
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const message =
    typeof payload === "object" && payload !== null
      ? (apiErrorMessage(payload) ?? fallback)
      : fallback;

  throw new CalibraApiError(message, response.status, payload);
}

/**
 * {@link readJsonResponse} + contract validation: HTTP errors are still raised
 * as `CalibraApiError` first, only a successful body is checked against its
 * `@calibra-facil/contracts` schema (see `validateResponsePayload` for the
 * strict vs warn behavior).
 */
async function readValidatedJsonResponse<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  context: { endpoint: string; fallback: string } & ResponseValidationOptions,
): Promise<z.output<TSchema>> {
  const payload = await readJsonResponse(response, context.fallback);
  return validateResponsePayload(schema, payload, context.endpoint, context);
}

/**
 * {@link readValidatedJsonResponse} with the client's validation mode bound
 * once: a domain module builds one reader from its options and calls it as
 * `read(response, schema, "GET /api/x", "pt-BR failure message")`.
 */
export function createValidatedReader(options: ResponseValidationOptions) {
  return <TSchema extends z.ZodType>(
    response: Response,
    schema: TSchema,
    endpoint: string,
    fallback: string,
  ): Promise<z.output<TSchema>> =>
    readValidatedJsonResponse(response, schema, {
      endpoint,
      fallback,
      responseValidation: options.responseValidation,
      onResponseContractViolation: options.onResponseContractViolation,
    });
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
