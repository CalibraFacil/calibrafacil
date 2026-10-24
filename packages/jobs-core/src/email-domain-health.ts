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

import { readEmailConfig } from "@calibra-facil/config";
import { db, systemDb } from "@calibra-facil/db";
import { forOrg, type OrgExecutor } from "@calibra-facil/db/for-org";
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
    return readEmailConfig().resendApiKey;
  }
  // Legacy byok rows only. The key columns are nullable since managed mode.
  if (!masterKey || !row.resendApiKeyEncrypted || !row.resendApiKeyIv) {
    return undefined;
  }
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

/**
 * The two connections the sweep uses. The defaults are the real ones; a test
 * passes a `calibra_app` session as `application` to prove the sweep names the
 * laboratory on every statement it runs there.
 */
export type EmailDomainHealthConnections = {
  /** Per-laboratory work: runs under `calibra.organization_id` (row-level security). */
  application: OrgExecutor;
  /** Only the listing of every laboratory's sender domain (cross-laboratory by design). */
  system: Pick<OrgExecutor, "select">;
};

type AuditEvent = { action: string; details: Record<string, unknown> };

/**
 * One row's write: the update and its audit events commit together, in one
 * short transaction that names the row's laboratory. It runs AFTER the Resend
 * round-trip, never around it.
 */
async function applyRowWrite(
  application: OrgExecutor,
  row: EmailDomainRow,
  set: Partial<typeof organizationEmailDomain.$inferInsert>,
  events: AuditEvent[],
): Promise<void> {
  await forOrg(application, row.organizationId).transaction(async (tx) => {
    await tx
      .update(organizationEmailDomain)
      .set(set)
      .where(eq(organizationEmailDomain.id, row.id));
    if (events.length > 0) {
      await tx.insert(organizationEventLog).values(
        events.map((event) => ({
          organizationId: row.organizationId,
          action: event.action,
          entityType: "email_sender_domain",
          entityId: row.id,
          details: event.details,
        })),
      );
    }
  });
}

async function checkRow(
  application: OrgExecutor,
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
      await applyRowWrite(
        application,
        row,
        {
          keyStatus: "invalid",
          keyLastError: message,
          updatedAt: new Date(),
        },
        row.keyStatus !== "invalid"
          ? [
              {
                action: "email_sender_domain.key_failed",
                details: {
                  source: "health_cron",
                  failureClass: details.failureClass,
                  error: message,
                },
              },
            ]
          : [],
      );
      result.keyInvalid++;
      return;
    }

    // sender_config here means Resend no longer knows the domain (deleted in
    // the lab's dashboard) — record it as unverified so sends stop trying.
    if (details.failureClass === "sender_config") {
      await applyRowWrite(
        application,
        row,
        {
          status: "failed",
          verifiedAt: null,
          updatedAt: new Date(),
        },
        row.verifiedAt
          ? [
              {
                action: "email_sender_domain.verification_lost",
                details: {
                  source: "health_cron",
                  error: `${details.errorName}: ${details.message}`,
                },
              },
            ]
          : [],
      );
      result.unverified++;
      return;
    }

    // Transient / rate-limited: leave the row as-is; the next sweep retries.
    result.skipped++;
    return;
  }

  const isVerified = details.data.status === "verified";
  const now = new Date();
  const events: AuditEvent[] = [];
  if (isVerified && !row.verifiedAt) {
    events.push({
      action: "email_sender_domain.verified",
      details: { source: "health_cron", hostname: row.hostname },
    });
  }
  if (!isVerified && row.verifiedAt) {
    events.push({
      action: "email_sender_domain.verification_lost",
      details: {
        source: "health_cron",
        hostname: row.hostname,
        resendStatus: details.data.status,
      },
    });
  }
  if (row.keyStatus !== "ok") {
    events.push({
      action: "email_sender_domain.key_recovered",
      details: { source: "health_cron", previousKeyStatus: row.keyStatus },
    });
  }
  await applyRowWrite(
    application,
    row,
    {
      status: details.data.status,
      dnsRecords: details.data.records,
      verifiedAt: isVerified ? (row.verifiedAt ?? now) : null,
      lastVerifiedAt: isVerified ? now : row.lastVerifiedAt,
      keyStatus: "ok",
      keyLastError: null,
      updatedAt: now,
    },
    events,
  );

  if (isVerified) {
    result.verified++;
  } else {
    result.unverified++;
  }
}

export async function processEmailDomainHealth(
  connections: EmailDomainHealthConnections = {
    application: db,
    system: systemDb,
  },
): Promise<EmailDomainHealthResult> {
  const result: EmailDomainHealthResult = {
    checked: 0,
    verified: 0,
    unverified: 0,
    keyInvalid: 0,
    skipped: 0,
  };

  const masterKey = getEmailDomainMasterKey();
  // The sweep is a cron job: no request names a laboratory. Every laboratory's
  // sender domain is listed here, in ONE statement on the system path (the owner
  // connection), because row-level security names one laboratory per
  // transaction. Each row's write then runs in a transaction that names the
  // row's own laboratory, after the Resend call, never around it.
  const rows = await connections.system.select().from(organizationEmailDomain);

  // Sequential on purpose: one Resend call per LAB account, so there's no
  // fan-out win, and staying serial keeps each account under its rate limit.
  for (const row of rows) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- serial per-account polling
      await checkRow(connections.application, row, masterKey, result);
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
