import {
  validateResponsePayload,
  type ResponseValidationMode,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";
import type { z } from "zod";

import { getApiBaseUrl } from "@/lib/utils";

function defaultResponseValidation(): ResponseValidationMode {
  return import.meta.env.PROD ? "warn" : "strict";
}

type FetchPortalJsonOptions = ResponseValidationOptions & {
  /** Shown to the user when the API answers with an HTTP error. */
  errorMessage: string;
  /** Request init; credentials always `include`. Defaults to a GET. */
  init?: Omit<RequestInit, "credentials">;
};

/**
 * One typed read from the portal API (`/api/portal/*`): fetch with the session
 * cookie, then check the decoded JSON against its `@calibra-facil/contracts`
 * response schema. The result is typed by the schema, never `any`.
 *
 * A body that does not match throws in development (so API/contract drift
 * fails where it is introduced) and only logs a structured warning in
 * production, returning the body as received so the page keeps working.
 * Unit tests run strict too (as the web app does), so a stubbed `fetch` must
 * serve a contract-valid body: build it from
 * `@calibra-facil/contracts/jobs-fixtures`.
 */
export async function fetchPortalJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  {
    errorMessage,
    init,
    responseValidation = defaultResponseValidation(),
    onResponseContractViolation,
  }: FetchPortalJsonOptions,
): Promise<z.output<TSchema>> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(errorMessage);
  }

  const payload: unknown = await response.json();
  return validateResponsePayload(
    schema,
    payload,
    `${init?.method ?? "GET"} ${path}`,
    { responseValidation, onResponseContractViolation },
  );
}
