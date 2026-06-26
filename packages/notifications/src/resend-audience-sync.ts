// Sync lab-organization staff into the Resend marketing audience as Contacts.
//
// Foundation for later Broadcasts: we mirror exactly the lab-org INTERNAL_ROLE
// members (never portal client_users, never non-LAB orgs) into the audience,
// soft opt-in to the editorial topics (Novidades + Dicas — never the
// promotional Ofertas), honour the email-suppression list, and upsert
// idempotently. The whole path is gated behind MARKETING_CONTACT_SYNC_ENABLED
// (default OFF) so a merge/deploy can never blast the live audience until the
// operator opts in.
import { db } from "@calibra-facil/db";
import { member, organization, user } from "@calibra-facil/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { isEmailSuppressed } from "./suppression";
import {
  createResendContactsClient,
  type ContactUpsertInput,
} from "./resend-contacts-client";

/**
 * Internal lab-staff roles. Mirrors INTERNAL_ROLES in
 * packages/auth/src/access.ts (this package, like the portal-digest selection,
 * does not depend on @calibra-facil/auth). `client_user` is deliberately absent
 * so portal customers are never synced.
 */
const LAB_INTERNAL_ROLES: readonly string[] = [
  "member",
  "operator",
  "technician",
  "admin",
  "owner",
];

const LAB_ORG_TYPE = "LAB";

/** Upsert contacts in bounded batches so concurrency against Resend stays sane. */
const CONTACT_BATCH_SIZE = 20;

export interface ResendAudienceSyncEnv {
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
  RESEND_TOPIC_NOVIDADES_ID?: string;
  RESEND_TOPIC_DICAS_ID?: string;
  /** Safety gate. Sync only runs when this is exactly the string "true". */
  MARKETING_CONTACT_SYNC_ENABLED?: string;
}

/** A raw candidate row joined from member × organization × user. */
export interface RawAudienceMemberRow {
  email: string | null;
  name: string | null;
  role: string;
  organizationId: string;
  organizationName: string;
  organizationType: string | null;
  banned: boolean;
}

/** A selected, deduped contact ready to upsert. */
export interface LabAudienceContact {
  email: string;
  name: string | null;
  role: string;
  organizationId: string;
  organizationName: string;
  banned: boolean;
}

export interface ResendAudienceSyncDeps {
  /** Override the member source (defaults to the live DB query). */
  loadMembers?: () => Promise<RawAudienceMemberRow[]>;
  /** Override the suppression check (defaults to the marketing-scope list). */
  isSuppressed?: (email: string) => Promise<boolean>;
  /** Override `fetch` (tests mock the Resend HTTP contract here). */
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface ResendAudienceSyncResult {
  enabled: boolean;
  reason?: string;
  total: number;
  created: number;
  updated: number;
  suppressed: number;
  failed: number;
}

interface ResolvedSyncConfig {
  apiKey: string;
  audienceId: string;
  novidadesTopicId: string;
  dicasTopicId: string;
}

function resolveConfig(env: ResendAudienceSyncEnv): ResolvedSyncConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const audienceId = env.RESEND_AUDIENCE_ID?.trim();
  const novidadesTopicId = env.RESEND_TOPIC_NOVIDADES_ID?.trim();
  const dicasTopicId = env.RESEND_TOPIC_DICAS_ID?.trim();
  if (!apiKey || !audienceId || !novidadesTopicId || !dicasTopicId) {
    return null;
  }
  return { apiKey, audienceId, novidadesTopicId, dicasTopicId };
}

/**
 * Authoritative selection: keep only LAB-org members holding an internal role
 * with a usable email, deduped by normalized email (a user in multiple lab orgs
 * → one contact; first row wins). This is the single source of truth for "who
 * is a lab-audience contact", so the unit test feeds raw rows straight in.
 */
export function selectLabAudienceContacts(
  rows: RawAudienceMemberRow[],
): LabAudienceContact[] {
  const seen = new Set<string>();
  const contacts: LabAudienceContact[] = [];
  for (const row of rows) {
    if (row.organizationType !== LAB_ORG_TYPE) continue;
    if (!LAB_INTERNAL_ROLES.includes(row.role)) continue;
    const email = row.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      email,
      name: row.name,
      role: row.role,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      banned: row.banned,
    });
  }
  return contacts;
}

/** Live DB source: lab-org internal members with an email. */
async function loadLabAudienceMembers(): Promise<RawAudienceMemberRow[]> {
  return db
    .selectDistinct({
      email: user.email,
      name: user.name,
      role: member.role,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationType: organization.type,
      banned: user.banned,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(organization.type, LAB_ORG_TYPE),
        inArray(member.role, LAB_INTERNAL_ROLES),
        isNotNull(user.email),
      ),
    );
}

function splitName(name: string | null): {
  firstName?: string;
  lastName?: string;
} {
  const trimmed = name?.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  return { firstName, lastName };
}

function buildUpsertInput(
  contact: LabAudienceContact,
  suppressed: boolean,
  config: ResolvedSyncConfig,
): ContactUpsertInput {
  const { firstName, lastName } = splitName(contact.name);
  return {
    email: contact.email,
    firstName,
    lastName,
    unsubscribed: suppressed,
    // Only schema-derivable properties — no invented plan/lifecycle.
    properties: {
      account_type: "lab",
      role: contact.role,
      lab_id: contact.organizationId,
      lab_name: contact.organizationName,
    },
    // Soft opt-in to the two editorial topics; never the promotional Ofertas.
    // Suppressed/banned contacts get NO topics (and are unsubscribed above).
    topics: suppressed
      ? undefined
      : [
          { id: config.novidadesTopicId, subscription: "opt_in" },
          { id: config.dicasTopicId, subscription: "opt_in" },
        ],
  };
}

type ContactOutcome = {
  outcome: "created" | "updated" | "failed";
  suppressed: boolean;
};

export async function syncLabUsersToResendAudience(
  env: ResendAudienceSyncEnv,
  deps: ResendAudienceSyncDeps = {},
): Promise<ResendAudienceSyncResult> {
  const logger = deps.logger ?? console;
  const empty: ResendAudienceSyncResult = {
    enabled: false,
    total: 0,
    created: 0,
    updated: 0,
    suppressed: 0,
    failed: 0,
  };

  // REQ-SYNC-006: hard safety gate. Anything other than exactly "true" is a
  // no-op that performs ZERO Resend calls and never even loads members.
  if (env.MARKETING_CONTACT_SYNC_ENABLED !== "true") {
    logger.log(
      "[MarketingContactSync] disabled (MARKETING_CONTACT_SYNC_ENABLED != 'true'); skipping.",
    );
    return { ...empty, reason: "disabled" };
  }

  const resolved = resolveConfig(env);
  if (!resolved) {
    logger.warn(
      "[MarketingContactSync] RESEND_API_KEY / RESEND_AUDIENCE_ID / topic ids not fully configured; skipping.",
    );
    return { ...empty, reason: "missing-config" };
  }
  // Bind to a non-nullable const so the closure below keeps the narrowed type.
  const config: ResolvedSyncConfig = resolved;

  const loadMembers = deps.loadMembers ?? loadLabAudienceMembers;
  const isSuppressed =
    deps.isSuppressed ?? ((email: string) => isEmailSuppressed(email, "marketing"));

  const contacts = selectLabAudienceContacts(await loadMembers());

  const client = createResendContactsClient({
    apiKey: config.apiKey,
    audienceId: config.audienceId,
    fetchImpl: deps.fetchImpl,
  });

  const result: ResendAudienceSyncResult = {
    ...empty,
    enabled: true,
    total: contacts.length,
  };

  async function syncOneContact(
    contact: LabAudienceContact,
  ): Promise<ContactOutcome> {
    try {
      // Suppression-aware: banned users OR addresses on the marketing
      // suppression list are upserted unsubscribed, with no opt-in topics.
      const suppressed = contact.banned || (await isSuppressed(contact.email));
      const { created } = await client.upsertContact(
        buildUpsertInput(contact, suppressed, config),
      );
      return { outcome: created ? "created" : "updated", suppressed };
    } catch (error) {
      // REQ-SYNC-007: one contact's HTTP error must not abort the whole run.
      logger.error("[MarketingContactSync] contact upsert failed", {
        email: contact.email,
        error: error instanceof Error ? error.message : "unknown error",
      });
      return { outcome: "failed", suppressed: false };
    }
  }

  for (let i = 0; i < contacts.length; i += CONTACT_BATCH_SIZE) {
    const batch = contacts.slice(i, i + CONTACT_BATCH_SIZE);
    // oxlint-disable-next-line eslint/no-await-in-loop -- bounded batches: each batch must settle before the next so concurrency against the Resend API stays capped.
    const outcomes = await Promise.all(batch.map(syncOneContact));
    for (const { outcome, suppressed } of outcomes) {
      if (outcome === "created") result.created += 1;
      else if (outcome === "updated") result.updated += 1;
      else result.failed += 1;
      if (suppressed && outcome !== "failed") result.suppressed += 1;
    }
  }

  logger.log("[MarketingContactSync] run complete", result);
  return result;
}
