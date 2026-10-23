import { systemDb } from "@calibra-facil/db";
import {
  nonConformance,
  ootNotification,
  organization,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { orgDb } from "./org-db";

/**
 * Lookups of the PUBLIC out-of-tolerance acknowledgement route
 * (routes/oot-ack.ts, no session; ISO/IEC 17025 §7.10). The unguessable
 * ack-token in the e-mailed link IS the credential, and it yields the
 * laboratory that sent the notification, so the lookup by token cannot be
 * bound to an organization yet: it runs on the SYSTEM path (`systemDb`, the
 * owner connection; tenant-sql-allowlist.ts "public-token"). The
 * acknowledgement stamp that follows runs in `orgDb(laboratory).transaction`.
 */

/** The notification, its NC and its laboratory, by the e-mailed ack token. */
export async function findOotNotificationByAckToken(token: string) {
  const [row] = await systemDb
    .select({
      id: ootNotification.id,
      ncId: ootNotification.ncId,
      organizationId: ootNotification.organizationId,
      certificateNumber: ootNotification.certificateNumber,
      acknowledgedAt: ootNotification.acknowledgedAt,
      ncNumber: nonConformance.ncNumber,
      labName: organization.name,
    })
    .from(ootNotification)
    .innerJoin(nonConformance, eq(ootNotification.ncId, nonConformance.id))
    .innerJoin(
      organization,
      eq(ootNotification.organizationId, organization.id),
    )
    .where(eq(ootNotification.ackToken, token))
    .limit(1);
  return row ?? null;
}

/**
 * Stamps the acknowledgement of the notification the token resolved to, in the
 * laboratory that sent it (the caller has checked it was not acknowledged yet).
 * Returns whether a row was stamped, so the caller notifies only then.
 */
export async function stampOotAcknowledgementByLink(notification: {
  id: number;
  organizationId: string;
  token: string;
}): Promise<boolean> {
  return orgDb(notification.organizationId).transaction(async (o) => {
    const [updated] = await o
      .update(ootNotification)
      .set({
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date(),
        acknowledgedVia: "email_link",
      })
      .where(
        and(
          eq(ootNotification.ackToken, notification.token),
          eq(ootNotification.id, notification.id),
        ),
      )
      .returning({ id: ootNotification.id });
    return updated !== undefined;
  });
}
