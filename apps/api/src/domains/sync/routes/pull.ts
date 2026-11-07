import { createRouter } from "../../../server/router";
import {
  SYNC_MIN_PROTOCOL_VERSION,
  SYNC_PULL_PROTOCOL_PARAM,
  buildSyncResyncRequiredResponse,
  syncAckRequestSchema,
  syncAckResponseSchema,
  syncPullResponseSchema,
} from "@calibra-facil/contracts";
import { withLabPermission } from "../../../middleware/permission";
import { pullChangeLog } from "../change-log";
import { parseSyncPullLimit } from "../helpers";
import { updateRequiredBody } from "../minimum-desktop-version";
import { type SyncRouterEnv, getMemberData } from "./env";

export const pullRoutes = createRouter<SyncRouterEnv>()
  .get("/pull", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const limit = parseSyncPullLimit(c.req.query("limit"));
    const memberData = getMemberData(c);

    // The commit-ordered change log (domains/sync/change-log.ts). A pull that does not
    // state protocol 3 or later comes from a build that cannot read it (the `updatedAt`
    // pull of protocols 1 and 2 is gone): it is told to update.
    const requestedProtocol = Number.parseInt(
      c.req.query(SYNC_PULL_PROTOCOL_PARAM) ?? "",
      10,
    );
    if (!(requestedProtocol >= SYNC_MIN_PROTOCOL_VERSION)) {
      return c.json(updateRequiredBody(null), 426);
    }

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
