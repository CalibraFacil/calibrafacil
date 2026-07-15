/**
 * Daily health sweep for lab-owned email sending domains (issue #584 P4).
 *
 * DKIM records rotate and Resend API keys get revoked silently; without this
 * sweep those lapses are only discovered when a send fails over to the
 * platform sender. For every organization_email_domain row the worker asks
 * Resend (with the LAB's own key) for the domain's current verdict and
 * refreshes status, verification timestamps, DNS snapshot and key health.
 *
 * Rules mirror the send-time fallback semantics:
 *  - a successful round-trip proves the key works → keyStatus resets to "ok"
 *    (daily quota exhaustion also clears itself this way after the reset);
 *  - an invalid_key-class rejection flips keyStatus to "invalid" (audited on
 *    transition) so the settings UI shows the banner before any send fails;
 *  - transient/rate-limit failures leave the row untouched — next sweep
 *    retries.
 */

import { db } from "@calibra-facil/db";
import {
  organizationEmailDomain,
  organizationEventLog,
} from "@calibra-facil/db/schema";
import {
  decryptResendApiKey,
  getEmailDomainMasterKey,
  getResendDomain,
} from "@calibra-facil/email-sender";
import { eq } from "drizzle-orm";

export interface EmailDomainHealthResult {
  checked: number;
  verified: number;
  unverified: number;
  keyInvalid: number;
  skipped: number;
}

type EmailDomainRow = typeof organizationEmailDomain.$inferSelect;

function resolveApiKey(
  row: EmailDomainRow,
  masterKey: string | undefined,
): string | undefined {
  if (row.mode === "managed") {
    return process.env.RESEND_API_KEY;
  }
  if (!masterKey) return undefined;
  try {
    return decryptResendApiKey(
      row.resendApiKeyEncrypted,
      row.resendApiKeyIv,
      masterKey,
    );
  } catch (error) {
    console.error(
      `[EmailDomainHealth] Failed to decrypt key for org ${row.organizationId}:`,
      error,
    );
    return undefined;
  }
}

async function writeAuditEvent(
  row: EmailDomainRow,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(organizationEventLog).values({
      organizationId: row.organizationId,
      action,
      entityType: "email_sender_domain",
      entityId: row.id,
      details,
    });
  } catch (error) {
    console.error(
      `[EmailDomainHealth] Failed to write audit event for org ${row.organizationId}:`,
      error,
    );
  }
}

async function checkRow(
  row: EmailDomainRow,
  masterKey: string | undefined,
  result: EmailDomainHealthResult,
): Promise<void> {
  const apiKey = resolveApiKey(row, masterKey);
  if (!apiKey) {
    result.skipped++;
    return;
  }

  const details = await getResendDomain(apiKey, row.resendDomainId);
  result.checked++;

  if (!details.ok) {
    if (details.failureClass === "invalid_key") {
      const message = `${details.errorName}: ${details.message}`;
      await db
        .update(organizationEmailDomain)
        .set({
          keyStatus: "invalid",
          keyLastError: message,
          updatedAt: new Date(),
        })
        .where(eq(organizationEmailDomain.id, row.id));
      if (row.keyStatus !== "invalid") {
        await writeAuditEvent(row, "email_sender_domain.key_failed", {
          source: "health_cron",
          failureClass: details.failureClass,
          error: message,
        });
      }
      result.keyInvalid++;
      return;
    }

    // sender_config here means Resend no longer knows the domain (deleted in
    // the lab's dashboard) — record it as unverified so sends stop trying.
    if (details.failureClass === "sender_config") {
      await db
        .update(organizationEmailDomain)
        .set({
          status: "failed",
          verifiedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(organizationEmailDomain.id, row.id));
      if (row.verifiedAt) {
        await writeAuditEvent(row, "email_sender_domain.verification_lost", {
          source: "health_cron",
          error: `${details.errorName}: ${details.message}`,
        });
      }
      result.unverified++;
      return;
    }

    // Transient / rate-limited: leave the row as-is; the next sweep retries.
    result.skipped++;
    return;
  }

  const isVerified = details.data.status === "verified";
  const now = new Date();
  await db
    .update(organizationEmailDomain)
    .set({
      status: details.data.status,
      dnsRecords: details.data.records,
      verifiedAt: isVerified ? (row.verifiedAt ?? now) : null,
      lastVerifiedAt: isVerified ? now : row.lastVerifiedAt,
      keyStatus: "ok",
      keyLastError: null,
      updatedAt: now,
    })
    .where(eq(organizationEmailDomain.id, row.id));

  if (isVerified && !row.verifiedAt) {
    await writeAuditEvent(row, "email_sender_domain.verified", {
      source: "health_cron",
      hostname: row.hostname,
    });
  }
  if (!isVerified && row.verifiedAt) {
    await writeAuditEvent(row, "email_sender_domain.verification_lost", {
      source: "health_cron",
      hostname: row.hostname,
      resendStatus: details.data.status,
    });
  }
  if (row.keyStatus !== "ok") {
    await writeAuditEvent(row, "email_sender_domain.key_recovered", {
      source: "health_cron",
      previousKeyStatus: row.keyStatus,
    });
  }

  if (isVerified) {
    result.verified++;
  } else {
    result.unverified++;
  }
}

export async function processEmailDomainHealth(): Promise<EmailDomainHealthResult> {
  const result: EmailDomainHealthResult = {
    checked: 0,
    verified: 0,
    unverified: 0,
    keyInvalid: 0,
    skipped: 0,
  };

  const masterKey = getEmailDomainMasterKey();
  const rows = await db.select().from(organizationEmailDomain);

  // Sequential on purpose: one Resend call per LAB account, so there's no
  // fan-out win, and staying serial keeps each account under its rate limit.
  for (const row of rows) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- serial per-account polling
      await checkRow(row, masterKey, result);
    } catch (error) {
      console.error(
        `[EmailDomainHealth] Unexpected error for org ${row.organizationId}:`,
        error,
      );
      result.skipped++;
    }
  }

  console.log(`[EmailDomainHealth] Sweep complete: ${JSON.stringify(result)}`);
  return result;
}
