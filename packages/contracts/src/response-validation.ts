import type { z } from "zod";

/**
 * Runtime half of a response contract: every client (the SDK, the portal)
 * checks a decoded JSON body against the schema its endpoint is declared with.
 *
 * - `strict` (development, tests): throw {@link ResponseContractError} so drift
 *   between the API and these schemas fails loudly where it is introduced.
 * - `warn` (production): never break the UI over a contract mismatch. A
 *   structured warning is emitted (paths and codes only, never response
 *   values: they can be customer data) and the payload is returned as
 *   received, so the app behaves exactly as it did before validation existed.
 *
 * Contract schemas only validate (no defaults/transforms), so a payload that
 * matches is returned as-is, typed by the schema: every key the server sent is
 * kept, including keys the schema does not know about.
 */
export type ResponseValidationMode = "strict" | "warn";

export type ResponseContractIssue = {
  path: string;
  code: string;
  message: string;
};

export type ResponseContractViolation = {
  /** Stable endpoint label, e.g. `GET /api/jobs/:id`. */
  endpoint: string;
  issues: ResponseContractIssue[];
};

export type ResponseValidationOptions = {
  /** Defaults to `strict`. Production apps pass `warn`. */
  responseValidation?: ResponseValidationMode;
  /** Sink for `warn` mode. Defaults to a structured console warning. */
  onResponseContractViolation?: (violation: ResponseContractViolation) => void;
};

const MAX_REPORTED_ISSUES = 10;

export class ResponseContractError extends Error {
  constructor(public readonly violation: ResponseContractViolation) {
    super(
      `A resposta de ${violation.endpoint} não cumpre o contrato: ${formatIssues(violation.issues)}`,
    );
    this.name = "ResponseContractError";
  }
}

export function validateResponsePayload<TSchema extends z.ZodType>(
  schema: TSchema,
  payload: unknown,
  endpoint: string,
  options: ResponseValidationOptions = {},
): z.output<TSchema> {
  if (matchesSchema<z.output<TSchema>>(schema, payload)) {
    return payload;
  }

  const violation: ResponseContractViolation = {
    endpoint,
    issues: describeIssues(schema, payload),
  };

  if ((options.responseValidation ?? "strict") === "strict") {
    throw new ResponseContractError(violation);
  }

  (options.onResponseContractViolation ?? logResponseContractViolation)(
    violation,
  );
  return passThroughUnvalidated<z.output<TSchema>>(payload);
}

function matchesSchema<TOutput>(
  schema: z.ZodType,
  payload: unknown,
): payload is TOutput {
  return schema.safeParse(payload).success;
}

function describeIssues(
  schema: z.ZodType,
  payload: unknown,
): ResponseContractIssue[] {
  const result = schema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * The one unchecked step left, only reachable in `warn` mode after the
 * mismatch was reported: the UI keeps working on the payload as received.
 */
function passThroughUnvalidated<TOutput>(payload: unknown): TOutput {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- production fallback: the payload failed its schema, was reported, and is handed through unvalidated so a contract mismatch never breaks the UI.
  return payload as TOutput;
}

function logResponseContractViolation(violation: ResponseContractViolation) {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      tag: "response-contract",
      msg: "API response does not match its contract schema",
      endpoint: violation.endpoint,
      issues: violation.issues,
    }),
  );
}

function formatIssues(issues: ResponseContractIssue[]) {
  return issues
    .map((issue) => `${issue.path || "(raiz)"}: ${issue.message}`)
    .join("; ");
}
