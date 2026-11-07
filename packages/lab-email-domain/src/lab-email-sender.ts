/**
 * Tenant sending-domain state for the lab-owned email domain:
 * resolve the sender and credential from `organization_email_domain`, and
 * record a key failure with its audit event. The transport (email-sender)
 * never touches these tables; it receives {@link labEmailSenderResolver}.
 *
 * A lab sends from its own domain only while EVERY gate holds:
 *   row active + Resend-verified + key not known-dead. Anything else resolves to `undefined` and the caller
 *   uses the platform sender (`RESEND_FROM_EMAIL`) — an email is never blocked
 *   on a DNS or key lapse.
 *
 * `keyStatus === "rate_limited"` (free-tier quota) still resolves: the quota
 * resets daily, and a failed attempt falls back to the platform sender in the
 * same send (see send.ts), so the path self-heals without a cron reset.
 */

import { readEmailConfig } from "@calibra-facil/config";
import { db } from "@calibra-facil/db";
import { forOrg } from "@calibra-facil/db/for-org";
import {
  organizationEmailDomain,
  organizationEventLog,
  type OrganizationEmailDomainKeyStatus,
} from "@calibra-facil/db/schema";
import { and, eq, ne } from "drizzle-orm";
import {
  decryptResendApiKey,
  EMAIL_DOMAIN_MASTER_KEY_ENV,
  getEmailDomainMasterKey,
  reportEmailError,
  type LabEmailCredential,
  type LabSenderResolver,
  type ResendFailureClass,
} from "@calibra-facil/email-sender";

/** Attached to EmailBrand so templates/layout know the mail is first-party. */
export interface LabEmailSenderInfo {
  organizationId: string;
  fromAddress: string;
  hostname: string;
}

async function findUsableEmailDomainRow(organizationId: string) {
  // Every statement of this module runs in an organization-bound transaction
  // (row-level security: `calibra.organization_id` names the laboratory).
  const [row] = await forOrg(db, organizationId).transaction((o) =>
    o
      .select()
      .from(organizationEmailDomain)
      .where(
        and(
          eq(organizationEmailDomain.organizationId, organizationId),
          eq(organizationEmailDomain.isActive, true),
          ne(organizationEmailDomain.keyStatus, "invalid"),
        ),
      )
      .limit(1),
  );

  if (!row?.verifiedAt) return undefined;
  return row;
}

/**
 * Resolve the lab's verified sender identity for brand building. Never
 * decrypts the API key — safe to attach to an EmailBrand that flows into
 * templates.
 */
export async function resolveLabEmailSender(
  organizationId: string,
): Promise<LabEmailSenderInfo | undefined> {
  try {
    const row = await findUsableEmailDomainRow(organizationId);
    if (!row) return undefined;
    if (row.mode === "byok" && !getEmailDomainMasterKey()) return undefined;
    if (row.mode === "managed" && !readEmailConfig().resendApiKey)
      return undefined;

    return {
      organizationId,
      fromAddress: row.fromAddress,
      hostname: row.hostname,
    };
  } catch (error) {
    reportEmailError(
      `Failed to resolve lab sender for org ${organizationId}`,
      error,
      { event: "lab_sender_resolve_failed" },
    );
    return undefined;
  }
}

/**
 * Resolve the decrypted sending credential at send time. Re-checks the row so
 * a deactivation between brand build and send is honored. Returns
 * `undefined` on any lapse (missing master key, decrypt failure) — the caller then uses the platform sender.
 */
export async function getLabEmailCredential(
  organizationId: string,
): Promise<LabEmailCredential | undefined> {
  try {
    const row = await findUsableEmailDomainRow(organizationId);
    if (!row) return undefined;

    // Managed: the domain lives in OUR Resend account, so the laboratory never
    // held a key and there is nothing to decrypt. This is the path every new
    // configuration takes.
    if (row.mode === "managed") {
      const platformKey = readEmailConfig().resendApiKey;
      if (!platformKey) return undefined;
      return {
        apiKey: platformKey,
        fromAddress: row.fromAddress,
        hostname: row.hostname,
      };
    }

    // Legacy bring-your-own-key. No new rows are created this way; the ones
    // that exist keep sending from the laboratory's own Resend account, which
    // costs a dozen lines and avoids a migration nobody needs yet.
    if (!row.resendApiKeyEncrypted || !row.resendApiKeyIv) return undefined;

    const masterKey = getEmailDomainMasterKey();
    if (!masterKey) {
      reportEmailError(
        `${EMAIL_DOMAIN_MASTER_KEY_ENV} is not set; falling back to the platform sender for org ${organizationId}`,
        undefined,
        { event: "lab_sender_master_key_missing" },
      );
      return undefined;
    }

    const apiKey = decryptResendApiKey(
      row.resendApiKeyEncrypted,
      row.resendApiKeyIv,
      masterKey,
    );

    return {
      apiKey,
      fromAddress: row.fromAddress,
      hostname: row.hostname,
    };
  } catch (error) {
    reportEmailError(
      `Failed to resolve lab credential for org ${organizationId}`,
      error,
      { event: "lab_credential_resolve_failed" },
    );
    return undefined;
  }
}

function keyStatusForFailure(
  failureClass: ResendFailureClass,
): OrganizationEmailDomainKeyStatus | undefined {
  if (failureClass === "invalid_key") return "invalid";
  if (failureClass === "quota_exhausted") return "rate_limited";
  return undefined;
}

/**
 * Record a lab-key failure observed at send time: flip `keyStatus`, stash the
 * error for the settings UI, and write an org audit event — but only on a
 * transition, so a dead key doesn't spam one audit row per email. Best-effort:
 * never throws.
 */
export async function markLabEmailKeyFailure(
  organizationId: string,
  failureClass: ResendFailureClass,
  message: string,
): Promise<void> {
  const nextStatus = keyStatusForFailure(failureClass);
  if (!nextStatus) return;

  try {
    // The flip and its audit entry commit together.
    await forOrg(db, organizationId).transaction(async (o) => {
      const updated = await o
        .update(organizationEmailDomain)
        .set({
          keyStatus: nextStatus,
          keyLastError: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationEmailDomain.organizationId, organizationId),
            ne(organizationEmailDomain.keyStatus, nextStatus),
          ),
        )
        .returning();

      const transitioned = updated[0];
      if (!transitioned) return;

      await o.insert(organizationEventLog).values({
        organizationId,
        action: "email_sender_domain.key_failed",
        entityType: "email_sender_domain",
        entityId: transitioned.id,
        details: { failureClass, keyStatus: nextStatus, error: message },
      });
    });
  } catch (error) {
    reportEmailError(
      `Failed to record key failure for org ${organizationId}`,
      error,
      { event: "lab_key_failure_record_failed" },
    );
  }
}

/** What `sendEmailWithLabSender` (email-sender) is given to resolve a lab's own credential. */
export const labEmailSenderResolver: LabSenderResolver = {
  getCredential: getLabEmailCredential,
  recordKeyFailure: markLabEmailKeyFailure,
};
