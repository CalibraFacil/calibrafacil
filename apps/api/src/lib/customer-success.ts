import { db } from "@calibra-facil/db";
import {
  organizationEventLog,
  organizationSuccessProfile,
  organizationSupportRequestEvent,
} from "@calibra-facil/db/schema";

export function calculateSlaTargetAt(hours: number, now = new Date()) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export async function ensureSuccessProfile(organizationId: string) {
  const existing = await db.query.organizationSuccessProfile.findFirst({
    where: (profile, { eq }) => eq(profile.organizationId, organizationId),
  });

  if (existing) return existing;

  const [created] = await db
    .insert(organizationSuccessProfile)
    .values({
      organizationId,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to initialize success profile");
  }

  return created;
}

export async function writeSupportRequestEvent(params: {
  supportRequestId: number;
  organizationId: string;
  actorUserId?: string | null;
  kind: "created" | "status_changed" | "assigned" | "public_reply" | "resolved";
  message: string;
  publicVisible?: boolean;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(organizationSupportRequestEvent).values({
    supportRequestId: params.supportRequestId,
    organizationId: params.organizationId,
    actorUserId: params.actorUserId ?? null,
    kind: params.kind,
    message: params.message,
    publicVisible: params.publicVisible ?? false,
    details: params.details ?? null,
  });
}

export async function writeOrganizationCustomerSuccessEvent(params: {
  organizationId: string;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(organizationEventLog).values({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId ?? null,
    actorMemberId: params.actorMemberId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
  });
}
