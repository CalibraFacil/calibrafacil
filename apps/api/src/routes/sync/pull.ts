import { Hono } from "hono";
import {
  SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
  SYNC_PULL_PROTOCOL_PARAM,
  buildSyncResyncRequiredResponse,
  syncAckRequestSchema,
  syncAckResponseSchema,
  syncPullResponseSchema,
} from "@calibra-facil/contracts";
import { withLabPermission } from "../../middleware/permission";
import { pullChangeLog } from "../../modules/sync/change-log";
import { parseSyncPullLimit } from "../../modules/sync/helpers";
import { parseSyncPullPosition } from "../../modules/sync/pull-cursor";
import { type SyncRouterEnv, getMemberData } from "./env";
import { loadCloudSyncEventsSince } from "../../modules/sync/cloud-events";

export const pullRoutes = new Hono<SyncRouterEnv>()
  .get("/pull", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const limit = parseSyncPullLimit(c.req.query("limit"));
    const memberData = getMemberData(c);

    // Protocol 3: the commit-ordered change log (modules/sync/change-log.ts).
    const requestedProtocol = Number.parseInt(
      c.req.query(SYNC_PULL_PROTOCOL_PARAM) ?? "",
      10,
    );
    if (requestedProtocol >= SYNC_CHANGE_SEQ_PROTOCOL_VERSION) {
      const pull = await pullChangeLog({
        scope: memberData,
        cursor: c.req.query("cursor"),
        limit,
      });
      if (pull.kind === "resync") {
        return c.json(buildSyncResyncRequiredResponse(pull.reason), 409);
      }
      return c.json(
        syncPullResponseSchema.parse({
          cursor: pull.cursor,
          hasMore: pull.hasMore,
          events: pull.events,
        }),
      );
    }

    // DEPRECATED (protocols 1 and 2): the `updatedAt` cursor. It cannot see a row whose
    // transaction commits after a later-written row was pulled, and it never carries a
    // hard delete. Kept so deployed desktops keep working until
    // SYNC_MIN_DESKTOP_VERSION excludes them (DEPLOYMENT.md); delete it then.
    const since = parseSyncPullPosition(c.req.query("cursor"));
    const pull = await loadCloudSyncEventsSince(memberData, since, limit);
    c.header("Deprecation", "true");

    return c.json(
      syncPullResponseSchema.parse({
        cursor: pull.cursor,
        hasMore: pull.hasMore,
        events: pull.events,
      }),
    );
  })
  .post("/ack", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const body = syncAckRequestSchema.parse(await c.req.json());

    return c.json(
      syncAckResponseSchema.parse({
        ok: true,
        cursor: body.cursor,
        acknowledgedAt: new Date().toISOString(),
      }),
    );
  });
