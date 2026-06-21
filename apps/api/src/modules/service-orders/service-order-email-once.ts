/**
 * Send-once helper for service-order lifecycle emails — mini-spec H.
 *
 * REQ-SOEMAIL-007: records each sent transition email keyed by
 * (serviceOrderId, eventKey) in the service_order_email_log table.
 *
 * REQ-SOEMAIL-008: IF a transition email's (serviceOrderId, eventKey) is
 * already recorded, skips dispatch (at-most-once per event).
 *
 * REQ-SOEMAIL-009: IF dispatch fails after the key is recorded, deletes the
 * log row so a later retry can resend.
 *
 * Design constraint: DB access lives ONLY here in apps/api — packages/notifications
 * remains DB-free (preserves the REQ-004 tenant-isolation boundary).
 *
 * This helper is BEST-EFFORT: it never throws out of the caller. All errors
 * (DB insert, dispatch, DB delete) are caught and logged.
 */

import { db } from "@calibra-facil/db";
import { serviceOrderEmailLog } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import type { ServiceOrderCustomerEmailResult } from "@calibra-facil/notifications";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input to sendServiceOrderEmailOnce.
 *
 * `dispatch` is an async callback that performs the actual email send and
 * returns a ServiceOrderCustomerEmailResult (or resolves/rejects).
 * The helper treats `sent: true` as success (keep the log row); any other
 * result or a thrown error is treated as failure (release the log row).
 */
export interface SendServiceOrderEmailOnceInput {
  /** Numeric PK of the service order. */
  serviceOrderId: number;
  /**
   * Stable event key for this transition, e.g.
   *   "nova_os"
   *   "orcamento_sent:42"   (per-quote so a genuinely new version still sends)
   */
  eventKey: string;
  /**
   * Callback that performs the actual email dispatch.
   * Returns a ServiceOrderCustomerEmailResult. May throw.
   *
   * Called ONLY when the key was successfully claimed (INSERT returned a row).
   * If it returns `sent: false` or throws, the claimed key is released
   * (DELETE) so the next retry can resend.
   */
  dispatch: () => Promise<ServiceOrderCustomerEmailResult>;
}

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Attempt to send a service-order transition email at most once per key.
 *
 * Algorithm:
 *  1. Claim the key:
 *     INSERT INTO service_order_email_log (service_order_id, event_key)
 *     ON CONFLICT (service_order_id, event_key) DO NOTHING RETURNING id
 *  2. If no row returned (conflict) → skip dispatch (REQ-008).
 *  3. If row returned (claimed) → call dispatch().
 *  4. If dispatch() returns sent: false OR throws → DELETE the log row
 *     so a retry can resend (REQ-009).
 *  5. If dispatch() returns sent: true → keep the log row (REQ-007).
 *
 * Never throws — all errors are caught and logged.
 */
export async function sendServiceOrderEmailOnce(
  input: SendServiceOrderEmailOnceInput,
): Promise<void> {
  const { serviceOrderId, eventKey, dispatch } = input;

  let claimedId: number | undefined;

  try {
    // Step 1: try to claim the key.
    const rows = await db
      .insert(serviceOrderEmailLog)
      .values({ serviceOrderId, eventKey })
      .onConflictDoNothing()
      .returning();

    // Step 2: conflict → skip (REQ-SOEMAIL-008).
    if (rows.length === 0) {
      return;
    }

    // Row was claimed — extract the id for potential rollback.
    claimedId = rows[0]?.id;
  } catch (error) {
    // DB error on insert — log and abort (don't dispatch without a claim).
    console.error(
      `[sendServiceOrderEmailOnce] DB insert failed for SO ${serviceOrderId} / key "${eventKey}":`,
      error,
    );
    return;
  }

  // Step 3: dispatch the email.
  let result: ServiceOrderCustomerEmailResult | null = null;
  try {
    result = await dispatch();
  } catch (error) {
    console.error(
      `[sendServiceOrderEmailOnce] dispatch() threw for SO ${serviceOrderId} / key "${eventKey}":`,
      error,
    );
    // fall through to step 4 — treat thrown error as not-sent
  }

  // Step 4: if dispatch did NOT send successfully, release the key (REQ-SOEMAIL-009).
  const sent = result?.sent === true;
  if (!sent && claimedId !== undefined) {
    try {
      await db
        .delete(serviceOrderEmailLog)
        .where(eq(serviceOrderEmailLog.id, claimedId));
    } catch (deleteError) {
      // Best-effort — log the failure but don't propagate.
      console.error(
        `[sendServiceOrderEmailOnce] DELETE (key release) failed for SO ${serviceOrderId} / key "${eventKey}" / log id ${claimedId}:`,
        deleteError,
      );
    }
  }
  // Step 5: sent: true → keep the log row (REQ-SOEMAIL-007). Nothing to do.
}
