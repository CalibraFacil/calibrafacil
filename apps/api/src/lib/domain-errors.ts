import type {
  ApiErrorBody,
  ApiErrorCode,
  ApiErrorDetails,
  ApiErrorJsonValue,
  ApiErrorStatus,
} from "@calibra-facil/contracts";
import type { Context } from "hono";

/**
 * Typed domain failures with a stable, machine-readable `code`.
 *
 * Convention (docs/architecture/api-client-contract.md): new endpoints THROW a
 * `DomainError` (`throw notFound("job_not_found", "Job nao encontrado")`) and
 * `applyErrorHandling` maps it once to `{ error, code, details? }` — never
 * `c.json({ error }, status)` for a domain failure. Handlers that are exercised
 * through a bare sub-router (no `app.onError`) can `return
 * domainErrorResponse(c, error)` instead; the body is identical.
 *
 * `code` comes from the closed registry in `@calibra-facil/contracts`
 * (`API_ERROR_CODES`), so clients can branch on it; `message` stays the pt-BR
 * text shown to the user.
 */

/**
 * 4xx are domain outcomes. A 5xx is accepted by the constructor only so a
 * deliberate server-side failure can still carry a code; the error handler
 * reports those as defects.
 */
export type DomainErrorStatus = ApiErrorStatus | 500 | 503;

export type DomainErrorInit = {
  code: ApiErrorCode;
  status: DomainErrorStatus;
  /** pt-BR text shown to the user; becomes the response `error`. */
  message: string;
  /** JSON-safe structured context for clients (`details` in the body). */
  details?: ApiErrorDetails;
  /**
   * Fields merged at the TOP LEVEL of the body, for endpoints whose response
   * shape predates this registry (e.g. `currentStatus` on a job conflict).
   * Do not use for new fields — put them in `details`.
   */
  legacyBody?: { [key: string]: ApiErrorJsonValue };
};

export type DomainErrorOptions = Pick<
  DomainErrorInit,
  "details" | "legacyBody"
>;

export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly status: DomainErrorStatus;
  readonly details: ApiErrorDetails | undefined;
  readonly legacyBody: { [key: string]: ApiErrorJsonValue } | undefined;

  constructor(init: DomainErrorInit) {
    super(init.message);
    this.name = "DomainError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.legacyBody = init.legacyBody;
  }
}

export class InvalidError extends DomainError {
  constructor(
    code: ApiErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super({ code, status: 400, message, ...options });
    this.name = "InvalidError";
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(
    code: ApiErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super({ code, status: 401, message, ...options });
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(
    code: ApiErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super({ code, status: 403, message, ...options });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(
    code: ApiErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super({ code, status: 404, message, ...options });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(
    code: ApiErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super({ code, status: 409, message, ...options });
    this.name = "ConflictError";
  }
}

export class UnprocessableError extends DomainError {
  constructor(
    code: ApiErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super({ code, status: 422, message, ...options });
    this.name = "UnprocessableError";
  }
}

/** 400 — the request itself is malformed or violates a business rule. */
export function invalid(
  code: ApiErrorCode,
  message: string,
  options?: DomainErrorOptions,
) {
  return new InvalidError(code, message, options);
}

/** 401 — no valid session/credential. */
export function unauthenticated(
  code: ApiErrorCode,
  message: string,
  options?: DomainErrorOptions,
) {
  return new UnauthenticatedError(code, message, options);
}

/** 403 — authenticated but not allowed. */
export function forbidden(
  code: ApiErrorCode,
  message: string,
  options?: DomainErrorOptions,
) {
  return new ForbiddenError(code, message, options);
}

/** 404 — the resource does not exist (or is not visible in the tenant). */
export function notFound(
  code: ApiErrorCode,
  message: string,
  options?: DomainErrorOptions,
) {
  return new NotFoundError(code, message, options);
}

/** 409 — the resource state forbids the operation or a concurrent write won. */
export function conflict(
  code: ApiErrorCode,
  message: string,
  options?: DomainErrorOptions,
) {
  return new ConflictError(code, message, options);
}

/** 422 — well-formed but semantically unprocessable. */
export function unprocessable(
  code: ApiErrorCode,
  message: string,
  options?: DomainErrorOptions,
) {
  return new UnprocessableError(code, message, options);
}

/** The JSON body a `DomainError` serialises to. */
export function domainErrorBody(
  error: DomainError,
): ApiErrorBody & { [key: string]: ApiErrorJsonValue | undefined } {
  return {
    ...error.legacyBody,
    error: error.message,
    code: error.code,
    ...(error.details ? { details: error.details } : {}),
  };
}

/**
 * Respond with a `DomainError` without throwing. Same body and status as the
 * `applyErrorHandling` mapping; use it where the handler runs without the
 * app-level error hook (bare sub-router tests) or must return, not throw.
 */
export function domainErrorResponse(c: Context, error: DomainError) {
  // newResponse, not c.json: Hono's JSONParsed<T> recurses forever on the
  // recursive JSON-value type of `details`. Context headers (CORS, request id)
  // are still merged, exactly as c.json does.
  return c.newResponse(JSON.stringify(domainErrorBody(error)), error.status, {
    "Content-Type": "application/json",
  });
}
