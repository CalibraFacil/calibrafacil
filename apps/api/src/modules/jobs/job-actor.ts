import type { OrgExecutor } from "@calibra-facil/db/for-org";
import type { JobActorAuditFields } from "@calibra-facil/db/job-events";
import { calibrationJob } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { orgDb } from "../../lib/org-db";
import {
  buildUnitScopeCondition,
  type ResolvedUnitScope,
} from "../../lib/units";

export type JobRow = typeof calibrationJob.$inferSelect;

export type UnitScope = Pick<
  ResolvedUnitScope,
  "selectedUnitScope" | "activeUnitId" | "accessibleUnitIds"
>;

/**
 * WHO is acting on a job. Every entry point builds one explicitly; a command
 * never infers it from a transport.
 *
 * - `user`: an authenticated lab member (the cloud routes).
 * - `api_key`: an organization API key acting for its creator, who is the
 *   accountable person recorded in the audit row; the key itself is recorded
 *   too, so the trail reads "creator X through key Y".
 * - `desktop_session`: the authenticated user whose desktop pushed an offline
 *   event. The identity is the session user, never the actor id claimed
 *   inside the event.
 */
export type JobActor =
  | { kind: "user"; userId: string; ipAddress?: string | null }
  | {
      kind: "api_key";
      /** The key's creator. */
      userId: string;
      apiKey: { id: string; name: string; keyPrefix: string };
      ipAddress?: string | null;
    }
  | { kind: "desktop_session"; userId: string; ipAddress?: string | null };

/**
 * The actors the job lifecycle commands (reject, cancel, assign, edit, amend)
 * accept: the desktop never pushes one of them (an offline job is only saved
 * and submitted), so `desktop_session` is not an option there.
 */
export type JobLifecycleActor = Exclude<JobActor, { kind: "desktop_session" }>;

/**
 * The `changes` fields that say HOW the actor reached the API, merged into
 * every audit row of a command: nothing for a signed-in user (the plain trail),
 * the channel and key identity for an API key, the sync source for a desktop.
 */
export function jobActorAuditFields(actor: JobActor): JobActorAuditFields {
  switch (actor.kind) {
    case "user":
      return {};
    case "desktop_session":
      return { source: "desktop_sync" };
    case "api_key":
      return {
        source: "public_api",
        channel: "api_key",
        apiKeyId: actor.apiKey.id,
        apiKeyName: actor.apiKey.name,
        apiKeyPrefix: actor.apiKey.keyPrefix,
      };
  }
}

/**
 * The job inside the caller's organization and unit scope; `null` scope is
 * organization-wide. Reads through the org-bound handle of the caller's
 * transaction when it passes one (row-level security); without one it reads in a
 * short transaction of its own that names the laboratory.
 */
export function loadScopedJob(
  params: {
    jobId: number;
    organizationId: string;
    unitScope: UnitScope | null;
  },
  executor?: Pick<OrgExecutor, "select">,
): Promise<JobRow | undefined> {
  const read = async (reader: Pick<OrgExecutor, "select">) => {
    const [job] = await reader
      .select()
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, params.jobId),
          eq(calibrationJob.organizationId, params.organizationId),
          params.unitScope
            ? buildUnitScopeCondition(calibrationJob.unitId, params.unitScope)
            : undefined,
        ),
      )
      .limit(1);
    return job;
  };
  return executor
    ? read(executor)
    : orgDb(params.organizationId).transaction(read);
}
