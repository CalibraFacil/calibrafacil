import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DomainError } from "../../lib/domain-errors";
import { buildPublicApiError } from "../../lib/public-api";

/**
 * The v2 answer to a refusal the lab's domain functions raise as a
 * `DomainError` (`createLabAsset`, `updateLabCustomer`, ...). The lab words its
 * refusals for its own screens (status, accents); the public API keeps the
 * status and the message it has always answered, in the v2 error envelope.
 * A `DomainError` whose code is not listed here is not a refusal the v2
 * contract knows: it is not mapped and reaches the app's error handler.
 */
const V2_REFUSALS: Partial<
  Record<
    DomainError["code"],
    { status: ContentfulStatusCode; message?: string }
  >
> = {
  customer_not_found: { status: 404, message: "Cliente não encontrado" },
  asset_type_not_found: {
    status: 404,
    message: "Tipo de instrumento não encontrado",
  },
  asset_not_found: { status: 404, message: "Ativo não encontrado" },
  // The lab answers 400; v2 has always answered 409.
  asset_tag_conflict: { status: 409, message: "Tag já está em uso" },
  asset_base_measurement_unit_required: { status: 400 },
};

/** The v2 response of a domain refusal, or `null` for any other error. */
export function v2Refusal(error: unknown): {
  status: ContentfulStatusCode;
  body: Record<string, unknown>;
} | null {
  if (!(error instanceof DomainError)) return null;
  const refusal = V2_REFUSALS[error.code];
  if (!refusal) return null;
  return {
    status: refusal.status,
    body: buildPublicApiError({
      code: error.code,
      message: refusal.message ?? error.message,
    }),
  };
}

/**
 * Runs a handler that is not idempotent (a PUT) and answers a domain refusal
 * it throws in the v2 envelope; any other error is rethrown.
 */
export async function answeringRefusals<E extends Env>(
  c: Context<E>,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const refusal = v2Refusal(error);
    if (!refusal) throw error;
    return c.json(refusal.body, refusal.status);
  }
}
