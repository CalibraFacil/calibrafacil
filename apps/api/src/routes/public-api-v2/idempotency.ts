import { orgDb } from "../../lib/org-db";
import { toRecord } from "@calibra-facil/shared/record";
import { type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  IdempotencyReservationLostError,
  buildPublicApiError,
  finalizeIdempotencyRecord,
  getIdempotencyKey,
  hashIdempotencyPayload,
  releaseIdempotencyReservation,
  reserveIdempotencyKey,
} from "../../lib/public-api";
import { withOrg, type OrgContext } from "../../lib/org-context";
import { type ApiKeyAuthVariables } from "../../middleware/api-key-auth";
import { apiKeyActor } from "./actor";
import { toIdempotencyResponseStatus } from "./helpers";
import { v2Refusal } from "./refusals";

/**
 * Idempotent public-API mutations (Idempotency-Key).
 *
 *   1. The key is RESERVED first, in a short transaction of its own that
 *      commits at once (`reserveIdempotencyKey`): a concurrent duplicate meets
 *      the reservation and is refused with 409 `idempotency_in_progress`; a
 *      finished one is replayed from the stored response; a different payload
 *      is 409 `idempotency_conflict`.
 *   2. `withIdempotentMutation`: the handler runs in the lab's write door
 *      (`withOrg`, as the key's creator) and the finalised record commits in
 *      the SAME transaction as its writes. A failure rolls both back and
 *      releases the reservation, so a retry with the same key runs the mutation
 *      once. Effects that need the committed rows (webhook delivery,
 *      notifications) go to `ctx.afterCommit`. A `DomainError` the lab's domain
 *      functions throw is answered as a v2 refusal (`v2Refusal`).
 *   3. `withIdempotentCommand`: for the job transitions whose command owns its
 *      transactions (`executeJob`, `submitJob`, `approveJob`, ...). They commit
 *      on their own, so the record is finalised right after, in a second short
 *      transaction. A crash in that gap lets a retry run the command again,
 *      which its status machine refuses (409) for every transition.
 *
 * A 5xx result is never recorded: the reservation is released so the retry the
 * message asks for runs the request afresh.
 */
export type IdempotentResult = {
  status: ContentfulStatusCode;
  body: Record<string, unknown>;
  resourceType?: "customer" | "asset" | "request" | "job";
  resourceId?: string | number | null;
};

export type IdempotentOptions = {
  /**
   * Maps an error the handler threw to a response. It runs AFTER the
   * transaction rolled back (so it can name a unique or foreign-key violation
   * without swallowing an error inside the transaction); return `null` to let
   * the error through. A `DomainError` with a v2 refusal is mapped without it.
   */
  mapError?: (error: unknown) => IdempotentResult | null;
};

type Begun =
  | { response: Response }
  | {
      token: string;
      organizationId: string;
    };

function isServerError(status: number) {
  return status >= 500;
}

function respond<E extends { Variables: ApiKeyAuthVariables }>(
  c: Context<E>,
  result: {
    status: ContentfulStatusCode | 204;
    body: Record<string, unknown>;
  },
) {
  if (result.status === 204) {
    // 204 responses have no body.
    return c.body(null, 204);
  }
  return c.json(result.body, result.status);
}

async function begin<E extends { Variables: ApiKeyAuthVariables }>(
  c: Context<E>,
  body: unknown,
): Promise<Begun> {
  const apiKey = c.get("apiKey");
  const key = getIdempotencyKey(c.req.raw.headers);

  if (!key) {
    return {
      response: c.json(
        buildPublicApiError({
          code: "missing_idempotency_key",
          message: "Informe o header Idempotency-Key para operações de escrita",
        }),
        400,
      ),
    };
  }

  const reservation = await reserveIdempotencyKey({
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    requestMethod: c.req.method,
    requestPath: new URL(c.req.url).pathname,
    idempotencyKey: key,
    requestHash: hashIdempotencyPayload(body),
  });

  switch (reservation.kind) {
    case "conflict":
      return {
        response: c.json(
          buildPublicApiError({
            code: "idempotency_conflict",
            message:
              "A mesma Idempotency-Key já foi usada com um payload diferente",
          }),
          409,
        ),
      };
    case "in_progress":
      return { response: inProgressResponse(c) };
    case "replay": {
      const status = toIdempotencyResponseStatus(reservation.responseStatus);
      return {
        response: respond(c, {
          status,
          body: toRecord(reservation.responseBody),
        }),
      };
    }
    case "reserved":
      return {
        token: reservation.token,
        organizationId: apiKey.organizationId,
      };
  }
}

function inProgressResponse<E extends { Variables: ApiKeyAuthVariables }>(
  c: Context<E>,
) {
  c.header("Retry-After", "1");
  return c.json(
    buildPublicApiError({
      code: "idempotency_in_progress",
      message:
        "Uma requisição com a mesma Idempotency-Key ainda está em andamento. Tente novamente em instantes",
    }),
    409,
  );
}

async function releaseQuietly(params: {
  organizationId: string;
  token: string;
}) {
  try {
    await releaseIdempotencyReservation(params);
  } catch (error) {
    // The reservation then expires on its own (IDEMPOTENCY_RESERVATION_TTL_MS).
    console.error("[PublicApi] Failed to release an idempotency key", error);
  }
}

type AfterCommitTask = () => unknown;

/**
 * Runs the effects of a committed command, one after the other. A failing side
 * effect (a webhook delivery, a notification) is logged and never turns the
 * committed command into an error.
 */
async function runAfterCommit(tasks: AfterCommitTask[]) {
  for (const task of tasks) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the effects run in the order the command registered them.
      await task();
    } catch (error) {
      console.error("[PublicApi] After-commit task failed", error);
    }
  }
}

/**
 * Runs `prepare` (outside any transaction, after the key is reserved), then
 * `handler` inside the one transaction the mutation and the idempotency record
 * commit in. `prepare` is for work that cannot join the transaction (a call on
 * the system path, the identity tables): the handler must not open a second
 * connection of its own, or concurrent requests can exhaust the pool while each
 * holds one waiting for another.
 */
export async function withPreparedIdempotentMutation<
  E extends { Variables: ApiKeyAuthVariables },
  P,
>(
  c: Context<E>,
  body: unknown,
  prepare: () => Promise<P>,
  handler: (ctx: OrgContext, prepared: P) => Promise<IdempotentResult>,
  options: IdempotentOptions = {},
) {
  const begun = await begin(c, body);
  if ("response" in begun) return begun.response;
  const { token, organizationId } = begun;

  let result: IdempotentResult;
  try {
    const prepared = await prepare();
    result = await withOrg(
      organizationId,
      apiKeyActor(c.get("apiKey"), c),
      async (ctx) => {
        const handled = await handler(ctx, prepared);
        // A failure result is not recorded (the retry it asks for must run).
        if (!isServerError(handled.status)) {
          await finalizeIdempotencyRecord(
            {
              organizationId,
              token,
              responseStatus: handled.status,
              responseBody: handled.body,
              resourceType: handled.resourceType,
              resourceId: handled.resourceId,
            },
            ctx.o,
          );
        }
        return handled;
      },
    );
  } catch (error) {
    // The transaction rolled back: neither the mutation nor a final record exist.
    if (error instanceof IdempotencyReservationLostError) {
      // The reservation expired and another request took the key over.
      return inProgressResponse(c);
    }
    const mapped: IdempotentResult | null =
      options.mapError?.(error) ?? v2Refusal(error);
    if (!mapped) {
      await releaseQuietly({ organizationId, token });
      throw error;
    }
    // A refusal that wrote nothing (the transaction rolled back): record it on
    // its own, as the answer the retries get.
    if (isServerError(mapped.status)) {
      await releaseQuietly({ organizationId, token });
      return respond(c, mapped);
    }
    try {
      await orgDb(organizationId).transaction((o) =>
        finalizeIdempotencyRecord(
          {
            organizationId,
            token,
            responseStatus: mapped.status,
            responseBody: mapped.body,
            resourceType: mapped.resourceType,
            resourceId: mapped.resourceId,
          },
          o,
        ),
      );
    } catch (finalizeError) {
      if (finalizeError instanceof IdempotencyReservationLostError) {
        return inProgressResponse(c);
      }
      await releaseQuietly({ organizationId, token });
      throw finalizeError;
    }
    return respond(c, mapped);
  }

  if (isServerError(result.status)) {
    await releaseQuietly({ organizationId, token });
  }
  // The effects registered with `ctx.afterCommit` already ran in `withOrg`.
  return respond(c, result);
}

export function withIdempotentMutation<
  E extends { Variables: ApiKeyAuthVariables },
>(
  c: Context<E>,
  body: unknown,
  handler: (ctx: OrgContext) => Promise<IdempotentResult>,
  options: IdempotentOptions = {},
) {
  return withPreparedIdempotentMutation(
    c,
    body,
    async () => undefined,
    (ctx) => handler(ctx),
    options,
  );
}

/**
 * For a handler whose work is a command that owns its transactions. The key is
 * reserved before the command runs and the record is finalised right after it,
 * not inside the command's transaction (see the header of this file).
 */
export async function withIdempotentCommand<
  E extends { Variables: ApiKeyAuthVariables },
>(
  c: Context<E>,
  body: unknown,
  handler: (
    afterCommit: (task: AfterCommitTask) => void,
  ) => Promise<IdempotentResult>,
) {
  const begun = await begin(c, body);
  if ("response" in begun) return begun.response;
  const { token, organizationId } = begun;
  const tasks: AfterCommitTask[] = [];

  let result: IdempotentResult;
  try {
    result = await handler((task) => {
      tasks.push(task);
    });
  } catch (error) {
    await releaseQuietly({ organizationId, token });
    throw error;
  }

  if (isServerError(result.status)) {
    await releaseQuietly({ organizationId, token });
  } else {
    try {
      await orgDb(organizationId).transaction((o) =>
        finalizeIdempotencyRecord(
          {
            organizationId,
            token,
            responseStatus: result.status,
            responseBody: result.body,
            resourceType: result.resourceType,
            resourceId: result.resourceId,
          },
          o,
        ),
      );
    } catch (error) {
      // The command committed but its record did not: give the key back, so a
      // retry reaches the command, which refuses a repeat transition.
      console.error(
        "[PublicApi] Failed to record an idempotent command",
        error,
      );
      await releaseQuietly({ organizationId, token });
    }
  }
  await runAfterCommit(tasks);
  return respond(c, result);
}
