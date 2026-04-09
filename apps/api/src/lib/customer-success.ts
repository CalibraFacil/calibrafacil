import { db } from "@calibra-facil/db";
import {
  organizationEventLog,
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationSupportRequestEvent,
  type NotificationPriority,
  type NotificationType,
} from "@calibra-facil/db/schema";
import { getRecipientsByRole, sendNotification } from "@calibra-facil/notifications";
import { eq } from "drizzle-orm";
import type {
  CustomerSuccessAccountOwnershipStatus,
  CustomerSuccessBlocker,
  CustomerSuccessBlockerScope,
  CustomerSuccessHealthStatus,
  CustomerSuccessNextActionStatus,
  CustomerSuccessSlaTier,
  CustomerSuccessSupportWorkflowState,
  CustomerSuccessWorkflowViolationCode,
  CustomerSuccessWorkflowWarningCode,
  CustomerSuccessWorkflowState,
  CustomerSuccessWorkflowSummary,
  CustomerSuccessWorkflowViolation,
  CustomerSuccessWorkflowWarning,
  GoLiveStatus,
  PlanSupportPolicy,
  SupportRequestPriority,
  SupportRequestSlaStatus,
  SupportRequestStatus,
} from "@calibra-facil/shared";
import { getOrganizationPlanAccess } from "./organization-plan";

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

function deriveDeliveryWorkflowState(params: {
  currentStatus: string;
  inactiveStatuses: string[];
  completedStatuses: string[];
  blockedStatuses: string[];
  hasScopedBlocker: boolean;
  isAtRisk?: boolean;
}) {
  if (params.completedStatuses.includes(params.currentStatus)) {
    return "COMPLETED" as const satisfies CustomerSuccessWorkflowState;
  }

  if (params.inactiveStatuses.includes(params.currentStatus)) {
    return "INACTIVE" as const satisfies CustomerSuccessWorkflowState;
  }

  if (
    params.blockedStatuses.includes(params.currentStatus) ||
    params.hasScopedBlocker
  ) {
    return "BLOCKED" as const satisfies CustomerSuccessWorkflowState;
  }

  if (params.isAtRisk) {
    return "AT_RISK" as const satisfies CustomerSuccessWorkflowState;
  }

  return "ACTIVE" as const satisfies CustomerSuccessWorkflowState;
}

function pushWorkflowWarning(
  warnings: CustomerSuccessWorkflowWarning[],
  warning: CustomerSuccessWorkflowWarning,
) {
  if (warnings.some((item) => item.code === warning.code)) {
    return;
  }

  warnings.push(warning);
}

function pushWorkflowViolation(
  violations: CustomerSuccessWorkflowViolation[],
  violation: CustomerSuccessWorkflowViolation,
) {
  if (violations.some((item) => item.code === violation.code)) {
    return;
  }

  violations.push(violation);
}

export function getSupportRequestSlaStatus(params: {
  status: SupportRequestStatus;
  slaTargetAt: Date | null;
  dueSoonThresholdHours?: number;
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

  if (deltaMs <= (params.dueSoonThresholdHours ?? 4) * 60 * 60 * 1000) {
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

export function resolveDueSoonThresholdHours(targetFirstResponseHours: number) {
  return Math.max(1, Math.min(8, Math.ceil(targetFirstResponseHours / 4)));
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

export function buildCustomerSuccessWorkflow(params: {
  supportPolicy: PlanSupportPolicy;
  effectiveSlaTier: CustomerSuccessSlaTier;
  prioritySupport: boolean;
  onboardingStatus: string;
  migrationStatus: string;
  goLiveStatus: GoLiveStatus;
  nextActionStatus: CustomerSuccessNextActionStatus;
  nextAction: string | null;
  internalOwnerUserId: string | null;
  blockers: CustomerSuccessBlocker[] | null | undefined;
  openRequestsCount: number;
  dueSoonRequestsCount: number;
  breachedRequestsCount: number;
  escalatedRequestsCount: number;
}) {
  const activeBlockers = getActiveCustomerSuccessBlockers(params.blockers);
  const onboardingState = deriveDeliveryWorkflowState({
    currentStatus: params.onboardingStatus,
    inactiveStatuses: ["NOT_STARTED"],
    completedStatuses: ["LIVE"],
    blockedStatuses: ["BLOCKED"],
    hasScopedBlocker: activeBlockers.some(
      (blocker) => blocker.scope === "ONBOARDING",
    ),
  });
  const migrationState = deriveDeliveryWorkflowState({
    currentStatus: params.migrationStatus,
    inactiveStatuses: ["NOT_REQUIRED"],
    completedStatuses: ["COMPLETED"],
    blockedStatuses: ["BLOCKED"],
    hasScopedBlocker: activeBlockers.some(
      (blocker) => blocker.scope === "MIGRATION",
    ),
  });
  const goLiveState = deriveDeliveryWorkflowState({
    currentStatus: params.goLiveStatus,
    inactiveStatuses: ["NOT_SCHEDULED"],
    completedStatuses: ["LIVE"],
    blockedStatuses: [],
    hasScopedBlocker: activeBlockers.some(
      (blocker) => blocker.scope === "GO_LIVE",
    ),
    isAtRisk: params.goLiveStatus === "AT_RISK",
  });

  const supportState =
    params.openRequestsCount === 0
      ? ("IDLE" as const satisfies CustomerSuccessSupportWorkflowState)
      : params.escalatedRequestsCount > 0 || params.breachedRequestsCount > 0
        ? ("ESCALATED" as const satisfies CustomerSuccessSupportWorkflowState)
        : params.dueSoonRequestsCount > 0
          ? ("AT_RISK" as const satisfies CustomerSuccessSupportWorkflowState)
          : ("ACTIVE" as const satisfies CustomerSuccessSupportWorkflowState);

  const hasActiveDeliveryWorkflows = [
    onboardingState,
    migrationState,
    goLiveState,
  ].some((state) => state !== "INACTIVE" && state !== "COMPLETED");
  const hasActiveSupportWorkflow = supportState !== "IDLE";
  const hasActiveWorkflows =
    hasActiveDeliveryWorkflows || hasActiveSupportWorkflow;

  const accountOwnershipStatus = !params.internalOwnerUserId
    ? hasActiveDeliveryWorkflows
      ? ("AT_RISK" as const satisfies CustomerSuccessAccountOwnershipStatus)
      : ("UNASSIGNED" as const satisfies CustomerSuccessAccountOwnershipStatus)
    : ("ASSIGNED" as const satisfies CustomerSuccessAccountOwnershipStatus);

  const targetFirstResponseBusinessHours = resolveEffectiveSlaHours(
    params.supportPolicy.targetFirstResponseBusinessHours,
    params.effectiveSlaTier,
  );
  const dueSoonThresholdBusinessHours = resolveDueSoonThresholdHours(
    targetFirstResponseBusinessHours,
  );
  const policy = {
    supportMode: params.supportPolicy.supportMode,
    effectiveSlaTier: params.effectiveSlaTier,
    prioritySupport: params.prioritySupport,
    targetFirstResponseBusinessHours,
    dueSoonThresholdBusinessHours,
    includesAssistedOnboarding: params.supportPolicy.includesAssistedOnboarding,
    includesAssistedMigration: params.supportPolicy.includesAssistedMigration,
    requiresInternalOwnerForActiveWorkflows: true,
    requiresNextActionForActiveWorkflows: true,
  } satisfies CustomerSuccessWorkflowSummary["policy"];

  const warnings: CustomerSuccessWorkflowWarning[] = [];
  const violations: CustomerSuccessWorkflowViolation[] = [];

  if (activeBlockers.length > 0) {
    pushWorkflowWarning(warnings, {
      code: "ACTIVE_BLOCKERS",
      message: "Existem bloqueios ativos impedindo o avanço do workflow.",
    });
  }

  if (params.goLiveStatus === "AT_RISK") {
    pushWorkflowWarning(warnings, {
      code: "GO_LIVE_AT_RISK",
      message: "O go-live está em risco e exige acompanhamento prioritário.",
    });
  }

  if (
    onboardingState !== "INACTIVE" &&
    onboardingState !== "COMPLETED" &&
    !params.supportPolicy.includesAssistedOnboarding
  ) {
    pushWorkflowWarning(warnings, {
      code: "ONBOARDING_NOT_INCLUDED_IN_PLAN",
      message:
        "O plano atual não inclui onboarding assistido, mas esse workflow está sendo acompanhado operacionalmente.",
    });
  }

  if (
    migrationState !== "INACTIVE" &&
    migrationState !== "COMPLETED" &&
    !params.supportPolicy.includesAssistedMigration
  ) {
    pushWorkflowWarning(warnings, {
      code: "MIGRATION_NOT_INCLUDED_IN_PLAN",
      message:
        "O plano atual não inclui migração assistida, mas esse workflow está sendo acompanhado operacionalmente.",
    });
  }

  if (params.nextActionStatus === "DUE_SOON") {
    pushWorkflowWarning(warnings, {
      code: "NEXT_ACTION_DUE_SOON",
      message: "A próxima ação vence em breve.",
    });
  }

  if (params.nextActionStatus === "OVERDUE") {
    pushWorkflowWarning(warnings, {
      code: "NEXT_ACTION_OVERDUE",
      message: "A próxima ação está atrasada.",
    });
  }

  if (params.dueSoonRequestsCount > 0) {
    pushWorkflowWarning(warnings, {
      code: "SLA_DUE_SOON",
      message: "Existem tickets com SLA próximo do vencimento.",
    });
  }

  if (params.breachedRequestsCount > 0) {
    pushWorkflowWarning(warnings, {
      code: "SLA_BREACHED",
      message: "Existem tickets fora do SLA alvo.",
    });
  }

  if (params.breachedRequestsCount > 0 || params.escalatedRequestsCount > 0) {
    pushWorkflowWarning(warnings, {
      code: "ESCALATION_REQUIRED",
      message: "Há tickets que exigem escalação ou acompanhamento prioritário.",
    });
  }

  if (
    policy.requiresInternalOwnerForActiveWorkflows &&
    hasActiveDeliveryWorkflows &&
    !params.internalOwnerUserId
  ) {
    pushWorkflowViolation(violations, {
      code: "MISSING_INTERNAL_OWNER",
      message:
        "Defina um responsável interno para contas com onboarding, migração ou go-live ativos.",
    });
  }

  if (
    policy.requiresNextActionForActiveWorkflows &&
    hasActiveDeliveryWorkflows &&
    !params.nextAction
  ) {
    pushWorkflowViolation(violations, {
      code: "MISSING_NEXT_ACTION",
      message:
        "Defina uma próxima ação para contas com onboarding, migração ou go-live ativos.",
    });
  }

  return {
    accountOwnershipStatus,
    onboardingState,
    migrationState,
    supportState,
    goLiveState,
    hasActiveDeliveryWorkflows,
    hasActiveSupportWorkflow,
    hasActiveWorkflows,
    warnings,
    violations,
    policy,
  } satisfies CustomerSuccessWorkflowSummary;
}

export interface CustomerSuccessAutomationSnapshot {
  workflow: CustomerSuccessWorkflowSummary;
  nextActionStatus: CustomerSuccessNextActionStatus;
  goLiveStatus: GoLiveStatus;
  effectiveSlaTier: CustomerSuccessSlaTier;
  prioritySupport: boolean;
  activeBlockersCount: number;
  dueSoonRequestsCount: number;
  breachedRequestsCount: number;
  escalatedRequestsCount: number;
}

function hasWorkflowWarning(
  workflow: CustomerSuccessWorkflowSummary,
  code: CustomerSuccessWorkflowWarningCode,
) {
  return workflow.warnings.some((warning) => warning.code === code);
}

function hasWorkflowViolation(
  workflow: CustomerSuccessWorkflowSummary,
  code: CustomerSuccessWorkflowViolationCode,
) {
  return workflow.violations.some((violation) => violation.code === code);
}

export async function getCustomerSuccessAutomationSnapshot(
  organizationId: string,
): Promise<CustomerSuccessAutomationSnapshot> {
  const [profile, planAccess, requests] = await Promise.all([
    ensureSuccessProfile(organizationId),
    getOrganizationPlanAccess(organizationId),
    db.query.organizationSupportRequest.findMany({
      where: eq(organizationSupportRequest.organizationId, organizationId),
      columns: {
        status: true,
        priority: true,
        slaTargetAt: true,
        escalatedAt: true,
      },
    }),
  ]);

  const effectiveSlaTier =
    profile.slaTier === "PLAN_DEFAULT"
      ? deriveDefaultSlaTier(planAccess.supportPolicy)
      : profile.slaTier;
  const targetFirstResponseBusinessHours = resolveEffectiveSlaHours(
    planAccess.supportPolicy.targetFirstResponseBusinessHours,
    effectiveSlaTier,
  );
  const dueSoonThresholdHours = resolveDueSoonThresholdHours(
    targetFirstResponseBusinessHours,
  );

  const openRequests = requests
    .map((request) => ({
      ...request,
      slaStatus: getSupportRequestSlaStatus({
        status: request.status,
        slaTargetAt: request.slaTargetAt,
        dueSoonThresholdHours,
      }),
    }))
    .filter(
      (request) =>
        request.status === "OPEN" ||
        request.status === "IN_PROGRESS" ||
        request.status === "WAITING_ON_CUSTOMER",
    );

  const goLiveStatus = deriveGoLiveStatus({
    currentStatus: profile.goLiveStatus,
    goLiveActualDate: profile.goLiveActualDate,
    goLiveTargetDate: profile.goLiveTargetDate,
  });
  const nextActionStatus = deriveNextActionStatus({
    nextAction: profile.nextAction,
    nextActionDueAt: profile.nextActionDueAt,
    nextActionCompletedAt: profile.nextActionCompletedAt,
  });
  const prioritySupport =
    profile.prioritySupport ||
    effectiveSlaTier !== "PLAN_DEFAULT" ||
    planAccess.supportPolicy.hasPrioritySupport;
  const dueSoonRequestsCount = openRequests.filter(
    (request) => request.slaStatus === "DUE_SOON",
  ).length;
  const breachedRequestsCount = openRequests.filter(
    (request) => request.slaStatus === "BREACHED",
  ).length;
  const escalatedRequestsCount = openRequests.filter(
    (request) => request.escalatedAt !== null,
  ).length;
  const workflow = buildCustomerSuccessWorkflow({
    supportPolicy: planAccess.supportPolicy,
    effectiveSlaTier,
    prioritySupport,
    onboardingStatus: profile.onboardingStatus,
    migrationStatus: profile.migrationStatus,
    goLiveStatus,
    nextActionStatus,
    nextAction: profile.nextAction,
    internalOwnerUserId: profile.internalOwnerUserId,
    blockers: profile.blockers,
    openRequestsCount: openRequests.length,
    dueSoonRequestsCount,
    breachedRequestsCount,
    escalatedRequestsCount,
  });

  return {
    workflow,
    nextActionStatus,
    goLiveStatus,
    effectiveSlaTier,
    prioritySupport,
    activeBlockersCount: getActiveCustomerSuccessBlockers(profile.blockers).length,
    dueSoonRequestsCount,
    breachedRequestsCount,
    escalatedRequestsCount,
  };
}

async function notifyCustomerSuccessRecipients(params: {
  organizationId: string;
  actorUserId?: string | null;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
}) {
  const recipients = await getRecipientsByRole(params.organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientUserId of recipients) {
    if (recipientUserId === params.actorUserId) {
      continue;
    }

    try {
      await sendNotification({
        recipientUserId,
        organizationId: params.organizationId,
        type: params.type,
        priority: params.priority,
        title: params.title,
        message: params.message,
        relatedEntity: {
          entityType: "customer",
          entityId: params.organizationId,
        },
        actionUrl: "/dashboard/customer-success",
      });
    } catch (error) {
      console.error(
        "[Customer Success] Failed to send workflow notification:",
        error,
      );
    }
  }
}

export async function emitCustomerSuccessAutomationSignals(params: {
  organizationId: string;
  previous: CustomerSuccessAutomationSnapshot;
  next: CustomerSuccessAutomationSnapshot;
  actorUserId?: string | null;
}) {
  const signals: Array<{
    entered: boolean;
    action: string;
    details: Record<string, unknown>;
    notification?: {
      type: NotificationType;
      priority: NotificationPriority;
      title: string;
      message: string;
    };
  }> = [
    {
      entered:
        !hasWorkflowWarning(params.previous.workflow, "ACTIVE_BLOCKERS") &&
        hasWorkflowWarning(params.next.workflow, "ACTIVE_BLOCKERS"),
      action: "customer_success.workflow.blocked",
      details: {
        blockersCount: params.next.activeBlockersCount,
      },
      notification: {
        type: "CUSTOMER_SUCCESS_WORKFLOW_BLOCKED",
        priority: "HIGH",
        title: "Workflow bloqueado",
        message:
          "Existem bloqueios ativos no onboarding, migração ou go-live do seu laboratório.",
      },
    },
    {
      entered:
        !hasWorkflowWarning(params.previous.workflow, "GO_LIVE_AT_RISK") &&
        hasWorkflowWarning(params.next.workflow, "GO_LIVE_AT_RISK"),
      action: "customer_success.go_live.at_risk",
      details: {
        goLiveState: params.next.workflow.goLiveState,
      },
      notification: {
        type: "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK",
        priority: "HIGH",
        title: "Go-live em risco",
        message:
          "O go-live do laboratório entrou em estado de risco e exige acompanhamento prioritário.",
      },
    },
    {
      entered:
        !hasWorkflowWarning(params.previous.workflow, "NEXT_ACTION_OVERDUE") &&
        hasWorkflowWarning(params.next.workflow, "NEXT_ACTION_OVERDUE"),
      action: "customer_success.next_action.overdue",
      details: {
        nextActionStatus: params.next.nextActionStatus,
      },
      notification: {
        type: "CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE",
        priority: "MEDIUM",
        title: "Próxima ação atrasada",
        message:
          "Existe uma ação de acompanhamento atrasada no plano de Customer Success.",
      },
    },
    {
      entered:
        !hasWorkflowWarning(params.previous.workflow, "SLA_DUE_SOON") &&
        hasWorkflowWarning(params.next.workflow, "SLA_DUE_SOON"),
      action: "customer_success.support.sla_due_soon",
      details: {
        dueSoonRequestsCount: params.next.dueSoonRequestsCount,
      },
      notification: {
        type: "CUSTOMER_SUCCESS_SLA_DUE_SOON",
        priority: "MEDIUM",
        title: "SLA prestes a vencer",
        message: `Existem ${params.next.dueSoonRequestsCount} solicitação(ões) de suporte próximas do vencimento do SLA.`,
      },
    },
    {
      entered:
        !hasWorkflowWarning(params.previous.workflow, "SLA_BREACHED") &&
        hasWorkflowWarning(params.next.workflow, "SLA_BREACHED"),
      action: "customer_success.support.sla_breached",
      details: {
        breachedRequestsCount: params.next.breachedRequestsCount,
      },
      notification: {
        type: "CUSTOMER_SUCCESS_SLA_BREACHED",
        priority: "HIGH",
        title: "SLA violado",
        message: `Existem ${params.next.breachedRequestsCount} solicitação(ões) de suporte fora do SLA alvo.`,
      },
    },
    {
      entered:
        !hasWorkflowWarning(params.previous.workflow, "ESCALATION_REQUIRED") &&
        hasWorkflowWarning(params.next.workflow, "ESCALATION_REQUIRED"),
      action: "customer_success.support.escalation_required",
      details: {
        escalatedRequestsCount: params.next.escalatedRequestsCount,
        supportState: params.next.workflow.supportState,
      },
      notification: {
        type: "CUSTOMER_SUCCESS_ESCALATION_REQUIRED",
        priority: "HIGH",
        title: "Escalação necessária",
        message:
          "O suporte do laboratório entrou em estado de escalação prioritária.",
      },
    },
    {
      entered:
        !hasWorkflowViolation(params.previous.workflow, "MISSING_INTERNAL_OWNER") &&
        hasWorkflowViolation(params.next.workflow, "MISSING_INTERNAL_OWNER"),
      action: "customer_success.owner.required",
      details: {
        accountOwnershipStatus: params.next.workflow.accountOwnershipStatus,
      },
    },
  ];

  for (const signal of signals) {
    if (!signal.entered) {
      continue;
    }

    await writeOrganizationCustomerSuccessEvent({
      organizationId: params.organizationId,
      actorUserId: null,
      action: signal.action,
      entityType: "organization_success_profile",
      details: {
        automated: true,
        ...signal.details,
      },
    });

    if (signal.notification) {
      await notifyCustomerSuccessRecipients({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        type: signal.notification.type,
        priority: signal.notification.priority,
        title: signal.notification.title,
        message: signal.notification.message,
      });
    }
  }
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
