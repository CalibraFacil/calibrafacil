import { db } from "@calibra-facil/db";
import { leads } from "@calibra-facil/db/schema";
import { notifyNewLead } from "@calibra-facil/notifications";
import type { LeadSubmissionInput } from "@calibra-facil/schemas";

export interface CreateLeadResult {
  ok: true;
  /** True when a honeypot hit was silently discarded (not persisted). */
  discarded: boolean;
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Persist a marketing-site lead and notify the sales inbox. Unauthenticated and
 * not org-scoped — see `leads` schema. Honeypot hits are accepted (so bots get
 * no signal) but neither stored nor notified.
 */
export async function createLead(
  input: LeadSubmissionInput,
): Promise<CreateLeadResult> {
  if (input.website.trim().length > 0) {
    return { ok: true, discarded: true };
  }

  await db.insert(leads).values({
    name: input.name,
    email: input.email,
    phone: orNull(input.phone),
    company: orNull(input.company),
    segment: input.segment,
    message: orNull(input.message),
    utmSource: orNull(input.utmSource),
    utmMedium: orNull(input.utmMedium),
    utmCampaign: orNull(input.utmCampaign),
    utmTerm: orNull(input.utmTerm),
    utmContent: orNull(input.utmContent),
    referrer: orNull(input.referrer),
  });

  // Best-effort: notifyNewLead swallows its own errors and returns a boolean,
  // so awaiting it never fails the request but guarantees delivery before the
  // serverless function returns.
  await notifyNewLead({
    name: input.name,
    email: input.email,
    phone: orNull(input.phone) ?? undefined,
    company: orNull(input.company) ?? undefined,
    segment: input.segment,
    message: orNull(input.message) ?? undefined,
    utmSource: orNull(input.utmSource) ?? undefined,
    utmCampaign: orNull(input.utmCampaign) ?? undefined,
    referrer: orNull(input.referrer) ?? undefined,
  });

  return { ok: true, discarded: false };
}
