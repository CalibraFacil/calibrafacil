import { Hono } from "hono";
import {
  syncConflictResolutionRequestSchema,
  syncConflictResolutionResponseSchema,
} from "@calibra-facil/contracts";
import { writeOrganizationAuditEvent } from "../../lib/audit";
import { orgDb } from "../../lib/org-db";
import { withLabPermission } from "../../middleware/permission";
import { type SyncRouterEnv, getMemberData } from "./env";

export const conflictRoutes = new Hono<SyncRouterEnv>().post(
  "/conflicts/:id/resolve",
  ...withLabPermission({ calibration: ["create"] }),
  async (c) => {
    const memberData = getMemberData(c);
    const session = c.get("session");
    const conflictId = c.req.param("id");
    const body = syncConflictResolutionRequestSchema.parse(await c.req.json());
    const resolvedAt = new Date().toISOString();

    await orgDb(memberData.organizationId).transaction((o) =>
      writeOrganizationAuditEvent(
        {
          organizationId: memberData.organizationId,
          unitId: memberData.activeUnitId,
          actorUserId: session.user.id,
          actorMemberId: memberData.id,
          action: "sync.conflict_resolved",
          entityType: "sync_conflict",
          entityId: conflictId,
          details: {
            conflictId,
            status: body.status,
            resolvedAt,
          },
        },
        o,
      ),
    );

    return c.json(
      syncConflictResolutionResponseSchema.parse({
        data: {
          id: conflictId,
          status: body.status,
          resolvedAt,
        },
      }),
    );
  },
);
