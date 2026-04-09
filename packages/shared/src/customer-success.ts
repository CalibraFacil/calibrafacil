export type OnboardingStatus =
  | "NOT_STARTED"
  | "DISCOVERY"
  | "CONFIGURATION"
  | "TRAINING"
  | "LIVE"
  | "BLOCKED";

export type MigrationStatus =
  | "NOT_REQUIRED"
  | "PLANNING"
  | "IN_PROGRESS"
  | "VALIDATION"
  | "COMPLETED"
  | "BLOCKED";

export type GoLiveStatus =
  | "NOT_SCHEDULED"
  | "SCHEDULED"
  | "AT_RISK"
  | "LIVE";

export type CustomerSuccessHealthStatus =
  | "HEALTHY"
  | "ATTENTION"
  | "CRITICAL";

export type CustomerSuccessSlaTier =
  | "PLAN_DEFAULT"
  | "PRIORITY"
  | "DEDICATED";

export type CustomerSuccessNextActionStatus =
  | "NONE"
  | "PENDING"
  | "DUE_SOON"
  | "OVERDUE"
  | "COMPLETED";

export type CustomerSuccessBlockerScope =
  | "ONBOARDING"
  | "MIGRATION"
  | "GO_LIVE"
  | "SUPPORT";

export type CustomerSuccessBlockerStatus = "ACTIVE" | "RESOLVED";

export interface CustomerSuccessBlocker {
  id: string;
  scope: CustomerSuccessBlockerScope;
  status: CustomerSuccessBlockerStatus;
  reason: string;
  createdAt: string;
  createdByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
}

export type SupportRequestCategory =
  | "GENERAL"
  | "TRAINING"
  | "MIGRATION"
  | "INTEGRATION"
  | "BILLING"
  | "INCIDENT";

export type SupportRequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportRequestStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_ON_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";

export type SupportEventKind =
  | "created"
  | "status_changed"
  | "assigned"
  | "public_reply"
  | "resolved"
  | "escalated";

export type SupportRequestSlaStatus =
  | "ON_TRACK"
  | "DUE_SOON"
  | "BREACHED"
  | "RESOLVED";

export type SupportMode = "standard" | "priority" | "dedicated";

export interface PlanSupportPolicy {
  supportMode: SupportMode;
  hasPrioritySupport: boolean;
  targetFirstResponseBusinessHours: number;
  targetResolutionLabel: string;
  includesAssistedOnboarding: boolean;
  includesAssistedMigration: boolean;
}

export type CustomerSuccessWorkflowState =
  | "INACTIVE"
  | "ACTIVE"
  | "BLOCKED"
  | "AT_RISK"
  | "COMPLETED";

export type CustomerSuccessSupportWorkflowState =
  | "IDLE"
  | "ACTIVE"
  | "AT_RISK"
  | "ESCALATED";

export type CustomerSuccessAccountOwnershipStatus =
  | "UNASSIGNED"
  | "ASSIGNED"
  | "AT_RISK";

export type CustomerSuccessWorkflowWarningCode =
  | "ACTIVE_BLOCKERS"
  | "GO_LIVE_AT_RISK"
  | "ONBOARDING_NOT_INCLUDED_IN_PLAN"
  | "MIGRATION_NOT_INCLUDED_IN_PLAN"
  | "NEXT_ACTION_DUE_SOON"
  | "NEXT_ACTION_OVERDUE"
  | "SLA_DUE_SOON"
  | "SLA_BREACHED"
  | "ESCALATION_REQUIRED";

export type CustomerSuccessWorkflowViolationCode =
  | "MISSING_INTERNAL_OWNER"
  | "MISSING_NEXT_ACTION";

export interface CustomerSuccessWorkflowWarning {
  code: CustomerSuccessWorkflowWarningCode;
  message: string;
}

export interface CustomerSuccessWorkflowViolation {
  code: CustomerSuccessWorkflowViolationCode;
  message: string;
}

export interface CustomerSuccessWorkflowPolicy {
  supportMode: SupportMode;
  effectiveSlaTier: CustomerSuccessSlaTier;
  prioritySupport: boolean;
  targetFirstResponseBusinessHours: number;
  dueSoonThresholdBusinessHours: number;
  includesAssistedOnboarding: boolean;
  includesAssistedMigration: boolean;
  requiresInternalOwnerForActiveWorkflows: boolean;
  requiresNextActionForActiveWorkflows: boolean;
}

export interface CustomerSuccessWorkflowSummary {
  accountOwnershipStatus: CustomerSuccessAccountOwnershipStatus;
  onboardingState: CustomerSuccessWorkflowState;
  migrationState: CustomerSuccessWorkflowState;
  supportState: CustomerSuccessSupportWorkflowState;
  goLiveState: CustomerSuccessWorkflowState;
  hasActiveDeliveryWorkflows: boolean;
  hasActiveSupportWorkflow: boolean;
  hasActiveWorkflows: boolean;
  warnings: CustomerSuccessWorkflowWarning[];
  violations: CustomerSuccessWorkflowViolation[];
  policy: CustomerSuccessWorkflowPolicy;
}
