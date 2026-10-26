import type { ApiErrorCode } from "@calibra-facil/contracts";
import { createHash, randomBytes } from "node:crypto";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  organizationUnit,
  publicApiIdempotencyKey,
  publicApiResourceRef,
} from "@calibra-facil/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { type PublicApiResourceType } from "@calibra-facil/shared";
import { encryptPassword } from "@calibra-facil/signing";
import { inOrgTransaction } from "./org-transaction";

const DEFAULT_IDEMPOTENCY_TTL_DAYS = 7;

export interface PublicApiEnv {
  PUBLIC_API_MASTER_KEY?: string;
  INTEGRATIONS_MASTER_KEY?: string;
}

export function getPublicApiRequestIp(headers: Headers) {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null
  );
}

/**
 * Public API v2 error envelope (`{ error: { code, message, details } }`). The
 * envelope is the v2 contract and stays as is; the `code` values come from the
 * shared registry (`API_ERROR_CODES` in @calibra-facil/contracts) so the two
 * API surfaces can never declare the same failure under different names.
 */
export function buildPublicApiError(params: {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  return {
    error: {
      code: params.code,
      message: params.message,
      details: params.details ?? null,
    },
  };
}

export function buildListMeta(params: {
  page: number;
  limit: number;
  total: number;
  filters?: Record<string, unknown>;
}) {
  return {
    page: params.page,
    limit: params.limit,
    total: params.total,
    hasNextPage: params.page * params.limit < params.total,
    filters: params.filters ?? {},
  };
}

export function normalizeExternalId(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getIdempotencyKey(headers: Headers) {
  return headers.get("idempotency-key")?.trim() ?? null;
}

export function hashIdempotencyPayload(input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex");
}

function getWebhookMasterKey(env: PublicApiEnv) {
  const key = env.PUBLIC_API_MASTER_KEY ?? env.INTEGRATIONS_MASTER_KEY;
  if (!key) {
    throw new Error("PUBLIC_API_MASTER_KEY não configurada");
  }

  return key;
}

export function createWebhookSecret(env: PublicApiEnv) {
  const raw = `whsec_${randomBytes(24).toString("base64url")}`;
  const encrypted = encryptPassword(raw, getWebhookMasterKey(env));

  return {
    raw,
    prefix: raw.slice(0, 12),
    encryptedSecret: encrypted.encryptedPassword,
    secretIv: encrypted.iv,
  };
}

// The reads and writes below run in the caller's org-bound transaction
// (`executor`) or in one of their own that names the laboratory (row-level
// security).
export async function getResourceExternalId(
  params: {
    organizationId: string;
    resourceType: PublicApiResourceType;
    resourceId: string | number;
  },
  executor?: OrgDb,
) {
  const [ref] = await inOrgTransaction(params.organizationId, executor, (o) =>
    o
      .select()
      .from(publicApiResourceRef)
      .where(
        and(
          eq(publicApiResourceRef.organizationId, params.organizationId),
          eq(publicApiResourceRef.resourceType, params.resourceType),
          eq(publicApiResourceRef.resourceId, String(params.resourceId)),
        ),
      )
      .limit(1),
  );

  return ref?.externalId ?? null;
}

export async function getResourceExternalIdMap(
  params: {
    organizationId: string;
    resourceType: PublicApiResourceType;
    resourceIds: Array<string | number>;
  },
  executor?: OrgDb,
) {
  const ids = Array.from(
    new Set(
      params.resourceIds
        .map((value) => String(value))
        .filter((value) => value.length > 0),
    ),
  );

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const refs = await inOrgTransaction(params.organizationId, executor, (o) =>
    o
      .select({
        resourceId: publicApiResourceRef.resourceId,
        externalId: publicApiResourceRef.externalId,
      })
      .from(publicApiResourceRef)
      .where(
        and(
          eq(publicApiResourceRef.organizationId, params.organizationId),
          eq(publicApiResourceRef.resourceType, params.resourceType),
          inArray(publicApiResourceRef.resourceId, ids),
        ),
      ),
  );

  return new Map(refs.map((ref) => [ref.resourceId, ref.externalId]));
}

export async function upsertResourceExternalId(
  params: {
    organizationId: string;
    apiKeyId?: string | null;
    resourceType: PublicApiResourceType;
    resourceId: string | number;
    externalId: string;
  },
  executor?: OrgDb,
) {
  await inOrgTransaction(params.organizationId, executor, async (o) => {
    await o
      .insert(publicApiResourceRef)
      .values({
        id: crypto.randomUUID(),
        organizationId: params.organizationId,
        resourceType: params.resourceType,
        resourceId: String(params.resourceId),
        externalId: params.externalId,
        createdByApiKeyId: params.apiKeyId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          publicApiResourceRef.organizationId,
          publicApiResourceRef.resourceType,
          publicApiResourceRef.resourceId,
        ],
        set: {
          externalId: params.externalId,
          updatedAt: new Date(),
        },
      });
  });
}

/**
 * Idempotency records of the public API.
 *
 * A mutation reserves its key FIRST, in a short transaction of its own that
 * commits before the work starts: the row is born in the in-progress state
 * (`response_status` 0), so a concurrent duplicate meets the reservation and is
 * refused instead of running the mutation a second time. The mutation then
 * writes and finalises the record in ONE transaction (`finalizeIdempotencyRecord`
 * with the mutation's handle): the record is final if and only if the mutation
 * committed. A failure releases the reservation; one that never gets released (a
 * crash) expires after `IDEMPOTENCY_RESERVATION_TTL_MS`, when the next request
 * with the key takes it over.
 */
export const IDEMPOTENCY_IN_PROGRESS_STATUS = 0;
export const IDEMPOTENCY_RESERVATION_TTL_MS = 5 * 60 * 1000;

export type IdempotencyKeyScope = {
  organizationId: string;
  apiKeyId: string;
  requestMethod: string;
  requestPath: string;
  idempotencyKey: string;
};

export type IdempotencyReservation =
  /** The caller owns the key; `token` identifies its reservation. */
  | { kind: "reserved"; token: string }
  /** The same request already finished: answer with the stored response. */
  | {
      kind: "replay";
      responseStatus: number;
      responseBody: Record<string, unknown>;
    }
  /** The key was used with a different payload. */
  | { kind: "conflict" }
  /** Another request holds the key and has not finished. */
  | { kind: "in_progress" };

/** The reservation the caller holds was taken over (it expired) or released. */
export class IdempotencyReservationLostError extends Error {
  constructor() {
    super("The idempotency reservation is no longer held by this request");
    this.name = "IdempotencyReservationLostError";
  }
}

export async function reserveIdempotencyKey(
  params: IdempotencyKeyScope & { requestHash: string },
): Promise<IdempotencyReservation> {
  return inOrgTransaction(
    params.organizationId,
    undefined,
    async (o): Promise<IdempotencyReservation> => {
      const now = new Date();
      const reservationExpiresAt = new Date(
        now.getTime() + IDEMPOTENCY_RESERVATION_TTL_MS,
      );
      const [inserted] = await o
        .insert(publicApiIdempotencyKey)
        .values({
          id: crypto.randomUUID(),
          organizationId: params.organizationId,
          apiKeyId: params.apiKeyId,
          requestMethod: params.requestMethod,
          requestPath: params.requestPath,
          idempotencyKey: params.idempotencyKey,
          requestHash: params.requestHash,
          responseStatus: IDEMPOTENCY_IN_PROGRESS_STATUS,
          responseBody: {},
          expiresAt: reservationExpiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: publicApiIdempotencyKey.id });
      if (inserted) return { kind: "reserved", token: inserted.id };

      const [existing] = await o
        .select()
        .from(publicApiIdempotencyKey)
        .where(
          and(
            eq(publicApiIdempotencyKey.organizationId, params.organizationId),
            eq(publicApiIdempotencyKey.apiKeyId, params.apiKeyId),
            eq(publicApiIdempotencyKey.requestMethod, params.requestMethod),
            eq(publicApiIdempotencyKey.requestPath, params.requestPath),
            eq(publicApiIdempotencyKey.idempotencyKey, params.idempotencyKey),
          ),
        )
        .limit(1);
      // Released between the insert and the read: the holder failed. The
      // client retries and gets the key.
      if (!existing) return { kind: "in_progress" };

      if (existing.requestHash !== params.requestHash) {
        return { kind: "conflict" };
      }
      if (existing.responseStatus !== IDEMPOTENCY_IN_PROGRESS_STATUS) {
        return {
          kind: "replay",
          responseStatus: existing.responseStatus,
          responseBody: toStoredBody(existing.responseBody),
        };
      }

      // In progress. A reservation past its expiry belongs to a request that
      // died: take it over with a compare-and-set that also renews the token,
      // so the dead request can never finalise it.
      const token = crypto.randomUUID();
      const [takenOver] = await o
        .update(publicApiIdempotencyKey)
        .set({ id: token, expiresAt: reservationExpiresAt })
        .where(
          and(
            eq(publicApiIdempotencyKey.id, existing.id),
            eq(
              publicApiIdempotencyKey.responseStatus,
              IDEMPOTENCY_IN_PROGRESS_STATUS,
            ),
            lt(publicApiIdempotencyKey.expiresAt, now),
          ),
        )
        .returning({ id: publicApiIdempotencyKey.id });
      return takenOver ? { kind: "reserved", token } : { kind: "in_progress" };
    },
  );
}

function toStoredBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/**
 * Turns the reservation into the final record. Called with the mutation's own
 * handle so the record commits with the mutation; a reservation that is no
 * longer the caller's throws, which rolls the mutation back with it.
 */
export async function finalizeIdempotencyRecord(
  params: {
    organizationId: string;
    token: string;
    responseStatus: number;
    responseBody: Record<string, unknown>;
    resourceType?: PublicApiResourceType;
    resourceId?: string | number | null;
  },
  executor?: OrgDb,
) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_IDEMPOTENCY_TTL_DAYS);

  const finalized = await inOrgTransaction(
    params.organizationId,
    executor,
    (o) =>
      o
        .update(publicApiIdempotencyKey)
        .set({
          responseStatus: params.responseStatus,
          responseBody: params.responseBody,
          resourceType: params.resourceType ?? null,
          resourceId: params.resourceId ? String(params.resourceId) : null,
          expiresAt,
        })
        .where(
          and(
            eq(publicApiIdempotencyKey.id, params.token),
            eq(
              publicApiIdempotencyKey.responseStatus,
              IDEMPOTENCY_IN_PROGRESS_STATUS,
            ),
          ),
        )
        .returning({ id: publicApiIdempotencyKey.id }),
  );
  if (finalized.length === 0) throw new IdempotencyReservationLostError();
}

/** Gives the key back after a failed request, so a retry runs it afresh. */
export async function releaseIdempotencyReservation(params: {
  organizationId: string;
  token: string;
}) {
  await inOrgTransaction(params.organizationId, undefined, (o) =>
    o
      .delete(publicApiIdempotencyKey)
      .where(
        and(
          eq(publicApiIdempotencyKey.id, params.token),
          eq(
            publicApiIdempotencyKey.responseStatus,
            IDEMPOTENCY_IN_PROGRESS_STATUS,
          ),
        ),
      ),
  );
}

export async function listAccessibleUnits(
  organizationId: string,
  executor?: OrgDb,
) {
  return inOrgTransaction(organizationId, executor, (o) =>
    o
      .select({
        id: organizationUnit.id,
        name: organizationUnit.name,
        slug: organizationUnit.slug,
        isDefault: organizationUnit.isDefault,
      })
      .from(organizationUnit)
      .where(
        and(
          eq(organizationUnit.organizationId, organizationId),
          eq(organizationUnit.status, "ACTIVE"),
        ),
      )
      .orderBy(organizationUnit.name),
  );
}

export async function resolvePublicApiUnitScope(
  params: {
    organizationId: string;
    requestedUnitId?: number | null;
  },
  executor?: OrgDb,
) {
  const units = await listAccessibleUnits(params.organizationId, executor);

  if (params.requestedUnitId == null) {
    return {
      availableUnits: units,
      selectedUnitId: null,
      selectedUnits: units,
    };
  }

  const selectedUnit = units.find((unit) => unit.id === params.requestedUnitId);
  if (!selectedUnit) {
    throw new Error("Unidade fora do escopo permitido");
  }

  return {
    availableUnits: units,
    selectedUnitId: selectedUnit.id,
    selectedUnits: [selectedUnit],
  };
}
