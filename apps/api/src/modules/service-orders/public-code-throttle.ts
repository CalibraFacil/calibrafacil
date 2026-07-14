/**
 * Per-IP failed-attempt throttle for the public approval-code redemption
 * endpoint (spec quote-approval-public-access, REQ-QPUB-014 [HIGH RISK]).
 *
 * Codes are low-entropy by design (8 chars over a 31-char alphabet ≈ 2^39.6),
 * so online guessing must be rate-limited. The API runs on serverless Vercel
 * functions — in-memory counters do not survive across invocations — so the
 * counter is a Postgres row per (ip_hash, fixed 15-minute window):
 *
 *   - check: SELECT the current window's row; >= max failures → 429.
 *   - record: single INSERT … ON CONFLICT DO UPDATE increment (atomic).
 *
 * The small check-then-increment race can overshoot by a request or two,
 * which is fine for an anti-brute-force control. Only FAILED redemptions
 * count; successful ones don't. The IP is stored as a SHA-256 hash — no raw
 * PII at rest (the audit event still records the raw IP, matching the
 * existing event-log practice).
 */

import { db } from "@calibra-facil/db";
import { publicCodeRedeemThrottle } from "@calibra-facil/db/schema";
import { and, eq, sql } from "drizzle-orm";

export const CODE_REDEEM_WINDOW_MS = 15 * 60_000;
export const CODE_REDEEM_MAX_FAILURES = 10;

/** Fixed-window bucket start for a given instant. */
export function currentRedeemWindowStart(nowMs: number): Date {
  return new Date(
    Math.floor(nowMs / CODE_REDEEM_WINDOW_MS) * CODE_REDEEM_WINDOW_MS,
  );
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of the caller IP (or "unknown") — the at-rest bucket key. */
export async function hashThrottleIp(ip: string | null): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip ?? "unknown"),
  );
  return toHex(new Uint8Array(digest));
}

export async function getFailedRedeemAttempts(
  ipHash: string,
  windowStartsAt: Date,
): Promise<number> {
  const [row] = await db
    .select({ failedAttempts: publicCodeRedeemThrottle.failedAttempts })
    .from(publicCodeRedeemThrottle)
    .where(
      and(
        eq(publicCodeRedeemThrottle.ipHash, ipHash),
        eq(publicCodeRedeemThrottle.windowStartsAt, windowStartsAt),
      ),
    )
    .limit(1);
  return row?.failedAttempts ?? 0;
}

export async function recordFailedRedeemAttempt(
  ipHash: string,
  windowStartsAt: Date,
): Promise<void> {
  await db
    .insert(publicCodeRedeemThrottle)
    .values({ ipHash, windowStartsAt, failedAttempts: 1 })
    .onConflictDoUpdate({
      target: [
        publicCodeRedeemThrottle.ipHash,
        publicCodeRedeemThrottle.windowStartsAt,
      ],
      set: {
        failedAttempts: sql`${publicCodeRedeemThrottle.failedAttempts} + 1`,
        updatedAt: new Date(),
      },
    });
}
