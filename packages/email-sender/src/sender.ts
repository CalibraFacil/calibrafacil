/**
 * Sender resolution for the lab-owned email domain (issue #584).
 *
 * A lab sends from its own domain only while EVERY gate holds:
 *   plan entitlement (email_sender_domain) + row active + Resend-verified +
 *   key not known-dead. Anything else resolves to `undefined` and the caller
 *   uses the platform sender (`RESEND_FROM_EMAIL`) — an email is never blocked
 *   on a DNS or key lapse.
 *
 * `keyStatus === "rate_limited"` (free-tier quota) still resolves: the quota
 * resets daily, and a failed attempt falls back to the platform sender in the
 * same send (see send.ts), so the path self-heals without a cron reset.
 */

import { db } from "@calibra-facil/db";
import {
  organizationEmailDomain,
  organizationEventLog,
  subscription,
  type OrganizationEmailDomainKeyStatus,
} from "@calibra-facil/db/schema";
import { hasEntitlement } from "@calibra-facil/shared";
import { and, eq, ne } from "drizzle-orm";
import {
  decryptResendApiKey,
  getEmailDomainMasterKey,
  EMAIL_DOMAIN_MASTER_KEY_ENV,
} from "./encryption";
import type { ResendFailureClass } from "./resend-domains";

/** Attached to EmailBrand so templates/layout know the mail is first-party. */
export interface LabEmailSenderInfo {
  organizationId: string;
  fromAddress: string;
  hostname: string;
}

export interface LabEmailCredential {
  apiKey: string;
  fromAddress: string;
  hostname: string;
}

async function organizationHasEmailSenderEntitlement(
  organizationId: string,
): Promise<boolean> {
  const [sub] = await db
    .select({ planId: subscription.planId })
    .from(subscription)
    .where(eq(subscription.organizationId, organizationId))
    .limit(1);

  return hasEntitlement(sub?.planId ?? "FREE", "email_sender_domain");
}

async function findUsableEmailDomainRow(organizationId: string) {
  const [row] = await db
    .select()
    .from(organizationEmailDomain)
    .where(
      and(
        eq(organizationEmailDomain.organizationId, organizationId),
        eq(organizationEmailDomain.isActive, true),
        ne(organizationEmailDomain.keyStatus, "invalid"),
      ),
    )
    .limit(1);

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
  // Without the master key no BYOK credential can ever be decrypted, so the
  // whole feature is inert: skip the lookups entirely. (Revisit if "managed"
  // mode ships — platform-key sends would not need the master key.)
  if (!getEmailDomainMasterKey()) return undefined;

  try {
    const row = await findUsableEmailDomainRow(organizationId);
    if (!row) return undefined;

    if (!(await organizationHasEmailSenderEntitlement(organizationId))) {
      return undefined;
    }

    return {
      organizationId,
      fromAddress: row.fromAddress,
      hostname: row.hostname,
    };
  } catch (error) {
    console.error(
      `[EmailSender] Failed to resolve lab sender for org ${organizationId}:`,
      error,
    );
    return undefined;
  }
}

/**
 * Resolve the decrypted sending credential at send time. Re-checks the row so
 * a deactivation/downgrade between brand build and send is honored. Returns
 * `undefined` on any lapse (missing master key, decrypt failure, entitlement
 * loss) — the caller then uses the platform sender.
 */
export async function getLabEmailCredential(
  organizationId: string,
): Promise<LabEmailCredential | undefined> {
  try {
    const row = await findUsableEmailDomainRow(organizationId);
    if (!row) return undefined;

    if (!(await organizationHasEmailSenderEntitlement(organizationId))) {
      return undefined;
    }

    if (row.mode === "managed") {
      // Future shared-platform-account mode: same wrapper, platform key.
      const platformKey = process.env.RESEND_API_KEY;
      if (!platformKey) return undefined;
      return {
        apiKey: platformKey,
        fromAddress: row.fromAddress,
        hostname: row.hostname,
      };
    }

    const masterKey = getEmailDomainMasterKey();
    if (!masterKey) {
      console.error(
        `[EmailSender] ${EMAIL_DOMAIN_MASTER_KEY_ENV} is not set; falling back to the platform sender for org ${organizationId}.`,
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
    console.error(
      `[EmailSender] Failed to resolve lab credential for org ${organizationId}:`,
      error,
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
    const updated = await db
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

    await db.insert(organizationEventLog).values({
      organizationId,
      action: "email_sender_domain.key_failed",
      entityType: "email_sender_domain",
      entityId: transitioned.id,
      details: { failureClass, keyStatus: nextStatus, error: message },
    });
  } catch (error) {
    console.error(
      `[EmailSender] Failed to record key failure for org ${organizationId}:`,
      error,
    );
  }
}

/** Clear a previously recorded key failure (rotation or recovered health). */
export async function markLabEmailKeyOk(organizationId: string): Promise<void> {
  try {
    await db
      .update(organizationEmailDomain)
      .set({ keyStatus: "ok", keyLastError: null, updatedAt: new Date() })
      .where(
        and(
          eq(organizationEmailDomain.organizationId, organizationId),
          ne(organizationEmailDomain.keyStatus, "ok"),
        ),
      );
  } catch (error) {
    console.error(
      `[EmailSender] Failed to reset key status for org ${organizationId}:`,
      error,
    );
  }
}
