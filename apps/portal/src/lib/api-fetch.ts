import {
  validateResponsePayload,
  type ResponseValidationMode,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";
import type { z } from "zod";

import { getApiBaseUrl } from "@/lib/utils";

/**
 * The portal's ONE door to the network. Every request to `/api/*` (and the one
 * external lookup) goes through here, and every JSON body is checked against a
 * `@calibra-facil/contracts` schema before a page sees it. Nothing else under
 * `apps/portal/src` may call `fetch` or `.json()` (the
 * `calibra/no-unparsed-portal-fetch` lint rule enforces it).
 *
 * Mismatch policy (same as the SDK, see `validateResponsePayload`): `strict`
 * in development and tests (drift throws where it is introduced), `warn` in
 * production (one structured warning, the body is returned as received so the
 * page keeps working). Unit tests run strict too, so a stubbed `fetch` must
 * serve a contract-valid body: build it from
 * `@calibra-facil/contracts/jobs-fixtures` / `portal-fixtures`.
 */

function defaultResponseValidation(): ResponseValidationMode {
  return import.meta.env.PROD ? "warn" : "strict";
}

/** An HTTP error answer: the status and the body the API sent (when JSON). */
export class PortalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PortalApiError";
  }
}

type RequestOptions = {
  /** Request init; `credentials` is set by the helper. Defaults to a GET. */
  init?: Omit<RequestInit, "credentials">;
  /**
   * `include` (default) sends the session cookie. Public endpoints (certificate
   * verification, quote access links) and the external lookup use `omit`.
   */
  credentials?: "include" | "omit";
};

type FetchPortalJsonOptions = ResponseValidationOptions &
  RequestOptions & {
    /** Shown to the user when the API answers with an HTTP error. */
    errorMessage: string;
    /**
     * Prefer the API's own message (`error`, else `message`) over
     * `errorMessage` when the error body carries one.
     */
    serverErrorMessage?: boolean;
  };

function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function serverMessage(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  for (const key of ["error", "message"]) {
    const value = Reflect.get(body, key);
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/**
 * The raw request, for the few callers that branch on the HTTP status before
 * reading a body (public quote access, certificate verification). Read the
 * body with {@link readPortalJson} or {@link readPortalJsonResult}.
 */
export function fetchPortalResponse(
  path: string,
  { init, credentials = "include" }: RequestOptions = {},
): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials });
}

/** Checks a successful response's JSON body against its contract schema. */
export async function readPortalJson<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  endpoint: string,
  options: ResponseValidationOptions = {},
): Promise<z.output<TSchema>> {
  const payload: unknown = await response.json();
  return validateResponsePayload(schema, payload, endpoint, {
    responseValidation:
      options.responseValidation ?? defaultResponseValidation(),
    onResponseContractViolation: options.onResponseContractViolation,
  });
}

/**
 * Like {@link readPortalJson} but a malformed body is DATA, not an exception:
 * for pages whose design is "anything unexpected renders the not-found state"
 * (the public links). Never throws on a bad shape or non-JSON body.
 */
export async function readPortalJsonResult<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<
  { success: true; data: z.output<TSchema> } | { success: false; error: Error }
> {
  const payload = await readBody(response);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: parsed.error };
}

/** Throws the HTTP error for a non-OK response. */
export async function throwPortalApiError(
  response: Response,
  errorMessage: string,
  serverErrorMessage = false,
): Promise<never> {
  const body = await readBody(response);
  const message =
    (serverErrorMessage ? serverMessage(body) : null) ?? errorMessage;
  throw new PortalApiError(message, response.status, body);
}

/**
 * One typed call to the portal API: fetch (session cookie by default), HTTP
 * errors become a {@link PortalApiError}, a successful body is checked against
 * its schema. The result is typed by the schema, never `any`.
 */
export async function fetchPortalJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  {
    errorMessage,
    serverErrorMessage,
    init,
    credentials,
    responseValidation,
    onResponseContractViolation,
  }: FetchPortalJsonOptions,
): Promise<z.output<TSchema>> {
  const response = await fetchPortalResponse(path, { init, credentials });
  if (!response.ok) {
    return throwPortalApiError(response, errorMessage, serverErrorMessage);
  }
  return readPortalJson(
    response,
    schema,
    `${init?.method ?? "GET"} ${path.split("?")[0]}`,
    { responseValidation, onResponseContractViolation },
  );
}

/** JSON request init: the method, the JSON header and the serialized body. */
export function jsonInit(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): RequestInit {
  return body === undefined
    ? { method }
    : {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
}

/**
 * A read from an external API (e.g. the ViaCEP address lookup): no cookies, the
 * body is still checked against a schema. Returns `null` on any failure, since
 * every caller treats these lookups as best-effort.
 */
export async function fetchExternalJson<TSchema extends z.ZodType>(
  url: string,
  schema: TSchema,
): Promise<z.output<TSchema> | null> {
  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) return null;
    const result = await readPortalJsonResult(response, schema);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
