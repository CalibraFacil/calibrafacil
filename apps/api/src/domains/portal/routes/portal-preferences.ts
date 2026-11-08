// The portal user's notification preferences.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  PORTAL_NOTIFICATION_TYPES,
} from "@calibra-facil/schemas";
import { requirePortalLabScope } from "../portal-lab-scope";
import { notificationPreference } from "@calibra-facil/db/schema";
import {
  portalNotificationEndpoints,
  type PortalNotificationPreferencesResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import { eq } from "drizzle-orm";
import {
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { type R2Env } from "../../../lib/storage";
import { orgDb } from "../../../lib/org-db";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

// Notification preferences exposed to the portal: the digest opt-in, the
// global email switch and the per-type channel map — the map restricted to
// the customer-facing whitelist (PortalUpdateNotificationPreferencesSchema).
// The row is per-user and shared with the lab surface, so reads project only
// the whitelisted keys and writes merge instead of clobbering.
type PortalPreferenceChannels = { inApp: boolean; email: boolean };

function portalPreferencesPayload(
  stored:
    | {
        preferences: Record<string, PortalPreferenceChannels | undefined>;
        emailEnabled: boolean;
        digestFrequency: "NONE" | "DAILY" | "WEEKLY";
      }
    | undefined,
) {
  const preferences: Record<string, PortalPreferenceChannels> = {};
  for (const type of PORTAL_NOTIFICATION_TYPES) {
    // Same fallback as the dispatcher (sendNotification): absent = both on.
    preferences[type] = stored?.preferences[type] ?? {
      inApp: true,
      email: true,
    };
  }
  return {
    digestFrequency: stored?.digestFrequency ?? "NONE",
    emailEnabled: stored?.emailEnabled ?? true,
    preferences,
  };
}

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalPreferencesRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /notification-preferences - Digest opt-in + per-type channel map
// (whitelisted types only) for the portal user
// =========================================================================
mount(
  portalPreferencesRouter,
  PREFIX,
  portalNotificationEndpoints.preferences,
  [...requirePortalProtected],
  async (c) => {
    const session = c.get("session");
    await requirePortalLabScope(c);

    const [prefs] = await orgDb(c.get("member").organizationId).transaction(
      (o) =>
        o
          .select({
            preferences: notificationPreference.preferences,
            emailEnabled: notificationPreference.emailEnabled,
            digestFrequency: notificationPreference.digestFrequency,
          })
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, session.user.id))
          .limit(1),
    );

    return portalPreferencesPayload(prefs);
  },
);

mount(
  portalPreferencesRouter,
  PREFIX,
  portalNotificationEndpoints.updatePreferences,
  [...requirePortalProtected],
  async (c, { body }) => {
    const session = c.get("session");
    await requirePortalLabScope(c);

    const input = body;

    const result = await withOrg(
      c.get("member").organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
          .select({
            preferences: notificationPreference.preferences,
            emailEnabled: notificationPreference.emailEnabled,
            digestFrequency: notificationPreference.digestFrequency,
          })
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, session.user.id))
          .limit(1);

        // Merge-write: the schema only lets whitelisted keys through, and the
        // spread preserves every other stored key — a dual-role user's
        // lab-side preferences survive portal edits untouched.
        const mergedPreferences = {
          ...(existing?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES),
          ...input.preferences,
        };
        const merged = {
          preferences: mergedPreferences,
          emailEnabled: input.emailEnabled ?? existing?.emailEnabled ?? true,
          digestFrequency:
            input.digestFrequency ?? existing?.digestFrequency ?? "NONE",
        };

        await ctx.o
          .insert(notificationPreference)
          .values({ userId: session.user.id, ...merged })
          .onConflictDoUpdate({
            target: notificationPreference.userId,
            set: merged,
          });

        return portalPreferencesPayload(
          merged,
        ) satisfies ServerShape<PortalNotificationPreferencesResponse>;
      },
    );
    return result;
  },
);
