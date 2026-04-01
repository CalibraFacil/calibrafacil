import { db } from "@calibra-facil/db";
import {
  organizationEventLog,
  organizationSuccessProfile,
  organizationSupportRequestEvent,
} from "@calibra-facil/db/schema";
import type {
  CustomerSuccessHealthStatus,
  CustomerSuccessSlaTier,
  GoLiveStatus,
  PlanSupportPolicy,
  SupportRequestStatus,
} from "@calibra-facil/shared";

export function calculateSlaTargetAt(hours: number, now = new Date()) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export function resolveEffectiveSlaHours(
  baseHours: number,
  slaTier: CustomerSuccessSlaTier,
) {
  if (slaTier === "DEDICATED") {
    return Math.max(1, Math.min(baseHours, 2));
  }

  if (slaTier === "PRIORITY") {
    return Math.max(1, Math.min(baseHours, 4));
  }

  return baseHours;
}

export function deriveDefaultSlaTier(
  supportPolicy: PlanSupportPolicy,
): CustomerSuccessSlaTier {
  if (supportPolicy.supportMode === "dedicated") return "DEDICATED";
  if (supportPolicy.supportMode === "priority") return "PRIORITY";
  return "PLAN_DEFAULT";
}

export function getSupportRequestSlaStatus(params: {
  status: SupportRequestStatus;
  slaTargetAt: Date | null;
  now?: Date;
}) {
  if (params.status === "RESOLVED" || params.status === "CLOSED") {
    return "RESOLVED" as const;
  }

  if (!params.slaTargetAt) {
    return "ON_TRACK" as const;
  }

  const now = params.now ?? new Date();
  const deltaMs = params.slaTargetAt.getTime() - now.getTime();

  if (deltaMs <= 0) {
    return "BREACHED" as const;
  }

  if (deltaMs <= 4 * 60 * 60 * 1000) {
    return "DUE_SOON" as const;
  }

  return "ON_TRACK" as const;
}

export function deriveGoLiveStatus(params: {
  currentStatus: GoLiveStatus;
  goLiveActualDate: Date | null;
  goLiveTargetDate: Date | null;
  now?: Date;
}) {
  if (params.goLiveActualDate) return "LIVE" as const;
  if (params.currentStatus === "AT_RISK") return "AT_RISK" as const;
  if (params.goLiveTargetDate) {
    return params.goLiveTargetDate.getTime() < (params.now ?? new Date()).getTime()
      ? ("AT_RISK" as const)
      : ("SCHEDULED" as const);
  }
  return "NOT_SCHEDULED" as const;
}

export function deriveHealthStatus(params: {
  currentStatus: CustomerSuccessHealthStatus;
  onboardingStatus: string;
  migrationStatus: string;
  goLiveStatus: GoLiveStatus;
  breachedRequestsCount: number;
  dueSoonRequestsCount: number;
}) {
  if (
    params.currentStatus === "CRITICAL" ||
    params.goLiveStatus === "AT_RISK" ||
    params.onboardingStatus === "BLOCKED" ||
    params.migrationStatus === "BLOCKED" ||
    params.breachedRequestsCount > 0
  ) {
    return "CRITICAL" as const;
  }

  if (
    params.currentStatus === "ATTENTION" ||
    params.dueSoonRequestsCount > 0 ||
    params.goLiveStatus === "SCHEDULED"
  ) {
    return "ATTENTION" as const;
  }

  return "HEALTHY" as const;
}

export function getRequestPriorityWeight(priority: string) {
  switch (priority) {
    case "URGENT":
      return 4;
    case "HIGH":
      return 3;
    case "NORMAL":
      return 2;
    default:
      return 1;
  }
}

export function getOrganizationWorkstreams(params: {
  onboardingStatus: string;
  migrationStatus: string;
  openRequestsCount: number;
}) {
  const workstreams: string[] = [];

  if (params.onboardingStatus !== "LIVE" && params.onboardingStatus !== "NOT_STARTED") {
    workstreams.push("ONBOARDING");
  }

  if (
    params.migrationStatus !== "NOT_REQUIRED" &&
    params.migrationStatus !== "COMPLETED"
  ) {
    workstreams.push("MIGRATION");
  }

  if (params.openRequestsCount > 0) {
    workstreams.push("SUPPORT");
  }

  return workstreams;
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
