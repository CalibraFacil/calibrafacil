import { db } from "@calibra-facil/db";
import { emailSuppression } from "@calibra-facil/db/schema";
import type {
  EmailSuppressionScope,
  EmailSuppressionReason,
  EmailSuppressionSource,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export type {
  EmailSuppressionScope,
  EmailSuppressionReason,
  EmailSuppressionSource,
};

export interface SuppressEmailInput {
  email: string;
  scope: EmailSuppressionScope;
  reason: EmailSuppressionReason;
  source: EmailSuppressionSource;
  note?: string | null;
}

/** Normalize an address for storage/lookup: trimmed + lowercased. */
export function normalizeSuppressionEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Scopes that must be consulted when asking "is this address suppressed at
 * `scope`?". A suppression at 'all' suppresses every class of mail, so checking
 * 'marketing' also has to consider 'all'.
 */
export function suppressionScopesToCheck(
  scope: EmailSuppressionScope,
): EmailSuppressionScope[] {
  return scope === "all" ? ["all"] : [scope, "all"];
}

/**
 * Idempotently suppress an address at a scope. Re-running with the same
 * (email, scope) updates the reason/source/note rather than inserting a
 * duplicate (UNIQUE (email, scope)).
 */
export async function suppressEmail(input: SuppressEmailInput): Promise<void> {
  const email = normalizeSuppressionEmail(input.email);
  const note = input.note ?? null;
  const now = new Date();

  await db
    .insert(emailSuppression)
    .values({
      email,
      scope: input.scope,
      reason: input.reason,
      source: input.source,
      note,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [emailSuppression.email, emailSuppression.scope],
      set: {
        reason: input.reason,
        source: input.source,
        note,
        updatedAt: now,
      },
    });
}

/**
 * True when `email` is suppressed at `scope` OR at the broader 'all' scope.
 */
export async function isEmailSuppressed(
  email: string,
  scope: EmailSuppressionScope,
): Promise<boolean> {
  const normalized = normalizeSuppressionEmail(email);
  const rows = await db
    .select({ id: emailSuppression.id })
    .from(emailSuppression)
    .where(
      and(
        eq(emailSuppression.email, normalized),
        inArray(emailSuppression.scope, suppressionScopesToCheck(scope)),
      ),
    )
    .limit(1);

  return rows.length > 0;
}
