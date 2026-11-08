// The out-of-tolerance notifications a portal user sees and acknowledges.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { requirePortalLabScope } from "../portal-lab-scope";
import {
  calibrationJob,
  asset,
  nonConformance,
  ootNotification,
} from "@calibra-facil/db/schema";
import {
  portalOotNotificationEndpoints,
  type PortalOotAcknowledgeResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import { notify } from "@calibra-facil/notifications";
import { eq, and, inArray, desc, isNull } from "drizzle-orm";
import { OOT_NOTIFICATION_MACHINE } from "@calibra-facil/schemas/machines";
import {
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { type R2Env } from "../../../lib/storage";
import { resolvePortalCustomerScope } from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalOotNotificationsRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /oot-notifications - §7.10 out-of-tolerance notifications addressed
// to this portal customer. Opaque id = the notification's
// ackToken (already the customer's ack credential in the e-mail link).
// The general in-app notification center lives at /api/portal/notifications
// (portal-notifications.ts) — this endpoint is OOT-specific.
// =========================================================================
mount(
  portalOotNotificationsRouter,
  PREFIX,
  portalOotNotificationEndpoints.list,
  [...requirePortalProtected],
  async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      return { data: [], counts: { total: 0, pending: 0 } };
    }

    const rows = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({
          token: ootNotification.ackToken,
          ncNumber: nonConformance.ncNumber,
          certificateNumber: ootNotification.certificateNumber,
          affectedScope: ootNotification.affectedScope,
          status: ootNotification.status,
          sentAt: ootNotification.sentAt,
          acknowledgedAt: ootNotification.acknowledgedAt,
          acknowledgedVia: ootNotification.acknowledgedVia,
          createdAt: ootNotification.createdAt,
          assetName: asset.name,
          assetTag: asset.tag,
          customerId: calibrationJob.customerId,
        })
        .from(ootNotification)
        .innerJoin(calibrationJob, eq(ootNotification.jobId, calibrationJob.id))
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .innerJoin(nonConformance, eq(ootNotification.ncId, nonConformance.id))
        .where(inArray(calibrationJob.customerId, scope.customerIds))
        .orderBy(desc(ootNotification.createdAt))
        .limit(100),
    );

    const data = rows.map((row) => ({
      id: row.token,
      ncNumber: row.ncNumber,
      certificateNumber: row.certificateNumber,
      affectedScope: row.affectedScope,
      status: row.status,
      sentAt: row.sentAt,
      acknowledgedAt: row.acknowledgedAt,
      acknowledgedVia: row.acknowledgedVia,
      createdAt: row.createdAt,
      assetName: row.assetName,
      assetTag: row.assetTag,
      unitName: scope.customerById.get(row.customerId)?.name ?? null,
    }));

    return {
      data,
      counts: {
        total: data.length,
        pending: data.filter((row) => row.acknowledgedAt === null).length,
      },
    };
  },
);

// =========================================================================
// POST /oot-notifications/:token/acknowledge - Registers receipt from the
// authenticated portal (acknowledgedVia portal_link). Idempotent; the WHERE
// re-checks customer scope so a token from another org can never be stamped.
// =========================================================================
mount(
  portalOotNotificationsRouter,
  PREFIX,
  portalOotNotificationEndpoints.acknowledge,
  [...requirePortalProtected],
  async (c, { params }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const token = params.token;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound(
        "oot_notification_not_found",
        "Notificação não encontrada",
      );
    }

    const response = await withOrg(
      scope.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        const [notification] = await ctx.o
          .select({
            id: ootNotification.id,
            ncId: ootNotification.ncId,
            organizationId: ootNotification.organizationId,
            acknowledgedAt: ootNotification.acknowledgedAt,
            ncNumber: nonConformance.ncNumber,
          })
          .from(ootNotification)
          .innerJoin(
            calibrationJob,
            eq(ootNotification.jobId, calibrationJob.id),
          )
          .innerJoin(
            nonConformance,
            eq(ootNotification.ncId, nonConformance.id),
          )
          .where(
            and(
              eq(ootNotification.ackToken, token),
              inArray(calibrationJob.customerId, scope.customerIds),
            ),
          )
          .limit(1);

        if (!notification) {
          throw notFound(
            "oot_notification_not_found",
            "Notificação não encontrada",
          );
        }

        if (!notification.acknowledgedAt) {
          const [updated] = await ctx.o
            .update(ootNotification)
            .set({
              status: "ACKNOWLEDGED",
              acknowledgedAt: new Date(),
              acknowledgedVia: "portal_link",
            })
            .where(
              and(
                eq(ootNotification.id, notification.id),
                isNull(ootNotification.acknowledgedAt),
                inArray(
                  ootNotification.status,
                  OOT_NOTIFICATION_MACHINE.allowedFrom("acknowledge"),
                ),
              ),
            )
            .returning();

          // Notified after the commit: the notification reads the row it is about.
          if (updated) {
            ctx.afterCommit(() =>
              notify("OOT_NOTIFICATION_ACKNOWLEDGED", {
                notificationId: notification.id,
                ncId: notification.ncId,
                ncNumber: notification.ncNumber,
                organizationId: notification.organizationId,
              }),
            );
          }
        }

        return {
          message: "Recebimento confirmado",
        } satisfies ServerShape<PortalOotAcknowledgeResponse>;
      },
    );
    return response;
  },
);
