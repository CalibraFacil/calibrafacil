import { systemDb } from "@calibra-facil/db";
import {
  serviceOrder,
  serviceOrderPublicAccessToken,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import {
  SERVICE_ORDER_MACHINE,
  canApproveServiceOrderQuote,
} from "@calibra-facil/schemas/machines";
import { and, eq } from "drizzle-orm";
import {
  conflict,
  gone,
  notFound,
  tooManyRequests,
} from "../../lib/domain-errors";
import { orgDb } from "../../lib/org-db";
import {
  APPROVAL_CODE_ALPHABET,
  APPROVAL_CODE_LENGTH,
  createPublicServiceOrderAccessToken,
  hashServiceOrderApprovalCode,
  hashServiceOrderToken,
  normalizeApprovalCode,
  recordServiceOrderEvent,
  resolveApprovalCodePepper,
  revokeActiveTokensForQuote,
} from "../../lib/service-order-workflow";
import {
  CODE_REDEEM_MAX_FAILURES,
  currentRedeemWindowStart,
  getFailedRedeemAttempts,
  hashThrottleIp,
  recordFailedRedeemAttempt,
} from "./public-code-throttle";
import {
  serviceOrderNotFound,
  serviceOrderQuoteNotFound,
} from "./service-order-errors";
import { getQuoteForAction } from "./service-order.queries";
import {
  getServiceOrderDetail,
  toClientVisibleServiceOrderDetail,
} from "./service-order.read-model";
import { portalBaseUrl } from "@calibra-facil/shared/public-urls";

type RequestMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** One generic answer for every dead link (REQ-QPUB-005): no existence oracle. */
function publicLinkInvalid() {
  return notFound("public_link_invalid", "Link invalido ou expirado");
}

type PublicAccessRow = typeof serviceOrderPublicAccessToken.$inferSelect;

/**
 * Discriminated lookup so the callers can distinguish "this link answered its
 * purpose" (REQ-QPUB-006 → 410) from every other dead-link case, which stays
 * a generic not-found (REQ-QPUB-005):
 * - "active": live grant.
 * - "decided": revoked because the quote was approved/rejected.
 * - "not_found": missing, expired, or revoked for any other reason
 *   (superseded, legacy null reason).
 */
type PublicAccessLookup =
  | { kind: "active"; access: PublicAccessRow }
  | { kind: "decided" }
  | { kind: "not_found" };

/**
 * SYSTEM PATH (P2-18g): the public link's token (or approval code) is the only
 * credential the visitor holds, and the grant row it resolves to is what LEARNS
 * the laboratory. No organization is known before this lookup, so it runs on
 * `systemDb` (the owner connection), by the unguessable hash only; every statement
 * after it runs in `orgDb(grant.organizationId).transaction(...)`.
 */
async function findPublicAccessGrant(
  by: "tokenHash" | "codeHash",
  hash: string,
) {
  const column =
    by === "tokenHash"
      ? serviceOrderPublicAccessToken.tokenHash
      : serviceOrderPublicAccessToken.codeHash;
  const [grant] = await systemDb
    .select()
    .from(serviceOrderPublicAccessToken)
    .where(eq(column, hash))
    .limit(1);
  return grant ?? null;
}

async function getPublicServiceOrderAccessByToken(
  token: string,
): Promise<PublicAccessLookup> {
  const tokenHash = await hashServiceOrderToken(token);
  const access = await findPublicAccessGrant("tokenHash", tokenHash);

  if (!access) return { kind: "not_found" };
  if (access.revokedAt) {
    return access.revokedReason === "decided"
      ? { kind: "decided" }
      : { kind: "not_found" };
  }
  if (access.expiresAt && access.expiresAt < new Date()) {
    return { kind: "not_found" };
  }
  return { kind: "active", access };
}

/**
 * Redeem a human-typeable approval code for a tokenized access URL
 * (spec quote-approval-public-access, mini-spec B).
 *
 * - REQ-QPUB-012: a valid, live code answers with the canonical
 *   /service-order-access/<token> URL. The emailed link token is
 *   unrecoverable (hash-only at rest), so redemption mints a fresh SIBLING
 *   token on the same grant (same org/OS/quote/expiry, no code) — revocation
 *   keys on quoteId, so siblings die with the decision too.
 * - REQ-QPUB-013: every miss (malformed, unknown, expired, revoked) returns
 *   the SAME generic not-found — no oracle for code/OS/quote existence.
 * - REQ-QPUB-014 [HIGH RISK]: failed attempts count against a durable per-IP
 *   fixed-window throttle; past the cap the endpoint answers throttled
 *   without even hashing the submission.
 * - REQ-QPUB-015: successful redemptions land in the service-order event log.
 */
export async function redeemServiceOrderAccessCode(
  rawCode: string,
  metadata: RequestMetadata,
): Promise<{ token: string; accessUrl: string }> {
  const ipHash = await hashThrottleIp(metadata.ipAddress ?? null);
  const windowStartsAt = currentRedeemWindowStart(Date.now());
  const failures = await getFailedRedeemAttempts(ipHash, windowStartsAt);
  if (failures >= CODE_REDEEM_MAX_FAILURES) {
    throw tooManyRequests("public_code_throttled", "muitas_tentativas");
  }

  async function miss(): Promise<never> {
    await recordFailedRedeemAttempt(ipHash, windowStartsAt);
    throw notFound("public_code_invalid", "codigo_invalido");
  }

  const normalized = normalizeApprovalCode(rawCode);
  const wellFormed =
    normalized.length === APPROVAL_CODE_LENGTH &&
    [...normalized].every((char) => APPROVAL_CODE_ALPHABET.includes(char));
  if (!wellFormed) return miss();

  const codeHash = await hashServiceOrderApprovalCode(
    normalized,
    resolveApprovalCodePepper(),
  );
  const grant = await findPublicAccessGrant("codeHash", codeHash);

  if (
    !grant ||
    grant.revokedAt ||
    (grant.expiresAt && grant.expiresAt < new Date())
  ) {
    return miss();
  }

  // From here on the laboratory is known (the grant names it): the sibling
  // token and the redemption event are written in one org-bound transaction.
  const sibling = await orgDb(grant.organizationId).transaction(async (o) => {
    const minted = await createPublicServiceOrderAccessToken({
      organizationId: grant.organizationId,
      serviceOrderId: grant.serviceOrderId,
      quoteId: grant.quoteId,
      expiresAt: grant.expiresAt,
      executor: o,
    });

    const [order] = await o
      .select({
        organizationId: serviceOrder.organizationId,
        unitId: serviceOrder.unitId,
      })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, grant.serviceOrderId))
      .limit(1);
    if (order) {
      await recordServiceOrderEvent(
        {
          organizationId: order.organizationId,
          unitId: order.unitId,
          serviceOrderId: grant.serviceOrderId,
          actorType: "public_token",
          actorId: String(grant.id),
          eventType: "service_order.public_code_redeemed",
          metadata: { quoteId: grant.quoteId },
          ipAddress: metadata.ipAddress ?? null,
          userAgent: metadata.userAgent ?? null,
        },
        o,
      );
    }
    return minted;
  });

  const portalAppUrl = portalBaseUrl();
  return {
    token: sibling.token,
    accessUrl: `${portalAppUrl}/service-order-access/${sibling.token}`,
  };
}

export async function viewPublicServiceOrderAccess(
  token: string,
  metadata: RequestMetadata,
) {
  const lookup = await getPublicServiceOrderAccessByToken(token);
  // REQ-QPUB-006: a decided grant answers 410 with a stable reason code and
  // no quote data — the page renders "orçamento já respondido" from it.
  if (lookup.kind === "decided") {
    throw gone("public_link_answered", "orcamento_respondido");
  }
  if (lookup.kind === "not_found") throw publicLinkInvalid();
  const access = lookup.access;

  return orgDb(access.organizationId).transaction(async (o) => {
    await o
      .update(serviceOrderPublicAccessToken)
      .set({ lastViewedAt: new Date() })
      .where(eq(serviceOrderPublicAccessToken.id, access.id));

    const detail = await getServiceOrderDetail(
      access.serviceOrderId,
      access.organizationId,
      undefined,
      o,
    );
    if (!detail) throw serviceOrderNotFound();

    await recordServiceOrderEvent(
      {
        organizationId: detail.organizationId,
        unitId: detail.unitId,
        serviceOrderId: detail.id,
        actorType: "public_token",
        actorId: String(access.id),
        eventType: "service_order.public_link_viewed",
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
      o,
    );

    const clientVisible = toClientVisibleServiceOrderDetail(detail);

    // REQ-QPUB-030: a quote-scoped token shows ITS quote — the one the approve
    // endpoint acts on — never a different (e.g. newer) version's pricing.
    // Service_order-scoped grants (quoteId null) keep the full filtered list.
    return access.quoteId
      ? {
          ...clientVisible,
          quotes: clientVisible.quotes.filter(
            (quote) => quote.id === access.quoteId,
          ),
        }
      : clientVisible;
  });
}

export async function approveQuoteWithPublicServiceOrderAccess(
  token: string,
  metadata: RequestMetadata,
) {
  // REQ-QPUB-007 [HIGH RISK]: anything but a live grant is rejected before
  // any write — expired/revoked links can never mutate the quote.
  const lookup = await getPublicServiceOrderAccessByToken(token);
  if (lookup.kind !== "active") throw publicLinkInvalid();
  const access = lookup.access;
  const quoteId = access.quoteId;
  if (!quoteId) throw publicLinkInvalid();

  return orgDb(access.organizationId).transaction(async (o) => {
    // Both rows are locked (quote first, as every quote decision does) so the
    // status checks below hold until the writes commit.
    const quote = await getQuoteForAction(
      access.serviceOrderId,
      quoteId,
      access.organizationId,
      o,
      { lock: true },
    );
    const [order] = await o
      .select()
      .from(serviceOrder)
      .where(eq(serviceOrder.id, access.serviceOrderId))
      .limit(1)
      .for("update");

    if (!quote || !order || !canApproveServiceOrderQuote(quote.status)) {
      throw conflict(
        "service_order_quote_not_decidable",
        "Orcamento nao pode ser aprovado",
      );
    }

    await o
      .update(serviceOrderQuote)
      .set({ status: "approved", approvedAt: new Date() })
      .where(
        and(
          eq(serviceOrderQuote.id, quote.id),
          eq(serviceOrderQuote.organizationId, quote.organizationId),
        ),
      );
    // REQ-QPUB-003 [HIGH RISK]: a decided quote's public links stop working.
    await revokeActiveTokensForQuote(o, {
      organizationId: order.organizationId,
      quoteId: quote.id,
      reason: "decided",
    });
    await o
      .update(serviceOrder)
      .set({
        // Same mid-job rule as the manual/portal paths: a customer approving a
        // re-quote through the emailed public link must not rewind an OS whose
        // instrument is already on the bench.
        ...(SERVICE_ORDER_MACHINE.canTransition(order.status, "approve_quote")
          ? {
              status: SERVICE_ORDER_MACHINE.requireTargetOf(
                order.status,
                "approve_quote",
              ),
            }
          : {}),
        approvedAt: new Date(),
        totalApprovedCents: quote.totalCents,
      })
      .where(eq(serviceOrder.id, order.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "public_token",
        actorId: String(access.id),
        eventType: "service_order.quote_approved_by_client",
        metadata: { quoteId: quote.id },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
      o,
    );

    return { ok: true as const };
  });
}

export async function rejectQuoteWithPublicServiceOrderAccess(
  token: string,
  input: { rejectionReason?: string | null },
  metadata: RequestMetadata,
) {
  // REQ-QPUB-007 [HIGH RISK]: anything but a live grant is rejected before
  // any write — expired/revoked links can never mutate the quote.
  const lookup = await getPublicServiceOrderAccessByToken(token);
  if (lookup.kind !== "active") throw publicLinkInvalid();
  const access = lookup.access;
  const quoteId = access.quoteId;
  if (!quoteId) throw publicLinkInvalid();

  return orgDb(access.organizationId).transaction(async (o) => {
    // Both rows are locked (quote first, as every quote decision does) so the
    // status checks below hold until the writes commit.
    const quote = await getQuoteForAction(
      access.serviceOrderId,
      quoteId,
      access.organizationId,
      o,
      { lock: true },
    );
    const [order] = await o
      .select()
      .from(serviceOrder)
      .where(eq(serviceOrder.id, access.serviceOrderId))
      .limit(1)
      .for("update");

    if (!quote || !order) throw serviceOrderQuoteNotFound();

    if (!canApproveServiceOrderQuote(quote.status)) {
      throw conflict(
        "service_order_quote_not_decidable",
        "Orcamento nao pode ser recusado",
      );
    }

    await o
      .update(serviceOrderQuote)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: input.rejectionReason ?? null,
      })
      .where(
        and(
          eq(serviceOrderQuote.id, quote.id),
          eq(serviceOrderQuote.organizationId, quote.organizationId),
        ),
      );
    // REQ-QPUB-003 [HIGH RISK]: a decided quote's public links stop working.
    await revokeActiveTokensForQuote(o, {
      organizationId: order.organizationId,
      quoteId: quote.id,
      reason: "decided",
    });
    await o
      .update(serviceOrder)
      .set({
        ...(SERVICE_ORDER_MACHINE.canTransition(order.status, "reject_quote")
          ? {
              status: SERVICE_ORDER_MACHINE.requireTargetOf(
                order.status,
                "reject_quote",
              ),
            }
          : {}),
        rejectedAt: new Date(),
      })
      .where(eq(serviceOrder.id, order.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "public_token",
        actorId: String(access.id),
        eventType: "service_order.quote_rejected_by_client",
        metadata: { quoteId: quote.id, reason: input.rejectionReason },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
      o,
    );

    return { ok: true as const };
  });
}
