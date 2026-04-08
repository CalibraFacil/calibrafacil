import { db } from "@calibra-facil/db";
import {
  organizationEventLog,
  organizationSuccessProfile,
  organizationSupportRequestEvent,
} from "@calibra-facil/db/schema";
import type {
  CustomerSuccessBlocker,
  CustomerSuccessBlockerScope,
  CustomerSuccessHealthStatus,
  CustomerSuccessNextActionStatus,
  CustomerSuccessSlaTier,
  GoLiveStatus,
  PlanSupportPolicy,
  SupportRequestPriority,
  SupportRequestSlaStatus,
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

export function deriveNextActionStatus(params: {
  nextAction: string | null;
  nextActionDueAt: Date | null;
  nextActionCompletedAt?: Date | null;
  now?: Date;
}) {
  if (params.nextActionCompletedAt) {
    return "COMPLETED" as const satisfies CustomerSuccessNextActionStatus;
  }

  if (!params.nextAction) {
    return "NONE" as const satisfies CustomerSuccessNextActionStatus;
  }

  if (!params.nextActionDueAt) {
    return "PENDING" as const satisfies CustomerSuccessNextActionStatus;
  }

  const now = params.now ?? new Date();
  const deltaMs = params.nextActionDueAt.getTime() - now.getTime();

  if (deltaMs <= 0) {
    return "OVERDUE" as const satisfies CustomerSuccessNextActionStatus;
  }

  if (deltaMs <= 24 * 60 * 60 * 1000) {
    return "DUE_SOON" as const satisfies CustomerSuccessNextActionStatus;
  }

  return "PENDING" as const satisfies CustomerSuccessNextActionStatus;
}

export function normalizeCustomerSuccessBlockers(
  blockers: CustomerSuccessBlocker[] | null | undefined,
) {
  return Array.isArray(blockers) ? blockers : [];
}

export function getActiveCustomerSuccessBlockers(
  blockers: CustomerSuccessBlocker[] | null | undefined,
) {
  return normalizeCustomerSuccessBlockers(blockers).filter(
    (blocker) => blocker.status === "ACTIVE",
  );
}

export function upsertCustomerSuccessBlocker(params: {
  blockers: CustomerSuccessBlocker[] | null | undefined;
  scope: CustomerSuccessBlockerScope;
  reason: string;
  actorUserId?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const normalized = normalizeCustomerSuccessBlockers(params.blockers);
  const next = normalized.filter(
    (blocker) => !(blocker.scope === params.scope && blocker.status === "ACTIVE"),
  );

  next.unshift({
    id: crypto.randomUUID(),
    scope: params.scope,
    status: "ACTIVE",
    reason: params.reason,
    createdAt: now.toISOString(),
    createdByUserId: params.actorUserId ?? null,
    resolvedAt: null,
    resolvedByUserId: null,
  });

  return next;
}

export function resolveCustomerSuccessBlocker(params: {
  blockers: CustomerSuccessBlocker[] | null | undefined;
  scope: CustomerSuccessBlockerScope;
  actorUserId?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return normalizeCustomerSuccessBlockers(params.blockers).map((blocker) =>
    blocker.scope === params.scope && blocker.status === "ACTIVE"
      ? {
          ...blocker,
          status: "RESOLVED" as const,
          resolvedAt: now.toISOString(),
          resolvedByUserId: params.actorUserId ?? null,
        }
      : blocker,
  );
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

export function getSupportRequestNeedsEscalation(params: {
  status: SupportRequestStatus;
  slaStatus: SupportRequestSlaStatus;
  priority: SupportRequestPriority;
  prioritySupport: boolean;
  escalatedAt: Date | null;
}) {
  if (params.status === "RESOLVED" || params.status === "CLOSED") {
    return false;
  }

  if (params.escalatedAt) {
    return false;
  }

  if (params.slaStatus === "BREACHED") {
    return true;
  }

  return (
    params.prioritySupport &&
    params.slaStatus === "DUE_SOON" &&
    (params.priority === "HIGH" || params.priority === "URGENT")
  );
}

export function getSupportRequestAttentionScore(params: {
  status: SupportRequestStatus;
  slaStatus: SupportRequestSlaStatus;
  priority: SupportRequestPriority;
  assignedToUserId: string | null;
  prioritySupport: boolean;
  escalatedAt: Date | null;
}) {
  let score = getRequestPriorityWeight(params.priority) * 10;

  if (params.slaStatus === "DUE_SOON") score += 20;
  if (params.slaStatus === "BREACHED") score += 45;
  if (!params.assignedToUserId) score += 10;
  if (params.prioritySupport) score += 8;
  if (params.escalatedAt) score += 15;
  if (params.status === "OPEN") score += 5;

  return score;
}

export function getOrganizationAttentionScore(params: {
  healthStatus: CustomerSuccessHealthStatus;
  prioritySupport: boolean;
  breachedRequestsCount: number;
  dueSoonRequestsCount: number;
  urgentRequestsCount: number;
  nextActionStatus: CustomerSuccessNextActionStatus;
  activeBlockersCount: number;
  goLiveStatus: GoLiveStatus;
  internalOwnerUserId: string | null;
}) {
  let score = 0;

  if (params.healthStatus === "ATTENTION") score += 25;
  if (params.healthStatus === "CRITICAL") score += 50;
  if (params.prioritySupport) score += 15;
  score += params.breachedRequestsCount * 20;
  score += params.dueSoonRequestsCount * 8;
  score += params.urgentRequestsCount * 10;
  score += params.activeBlockersCount * 15;

  if (params.nextActionStatus === "DUE_SOON") score += 10;
  if (params.nextActionStatus === "OVERDUE") score += 25;
  if (params.goLiveStatus === "AT_RISK") score += 20;
  if (!params.internalOwnerUserId) score += 8;

  return score;
}

export function buildWorkflowDelays(params: {
  nextActionStatus: CustomerSuccessNextActionStatus;
  goLiveStatus: GoLiveStatus;
  activeBlockersCount: number;
}) {
  return {
    hasBlockedWorkflow: params.activeBlockersCount > 0,
    goLiveAtRisk: params.goLiveStatus === "AT_RISK",
    nextActionOverdue: params.nextActionStatus === "OVERDUE",
    nextActionDueSoon: params.nextActionStatus === "DUE_SOON",
  };
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
  kind:
    | "created"
    | "status_changed"
    | "assigned"
    | "public_reply"
    | "resolved"
    | "escalated";
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
