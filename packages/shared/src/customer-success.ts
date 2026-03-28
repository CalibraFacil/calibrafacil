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
  | "resolved";

export type SupportMode = "standard" | "priority" | "dedicated";

export interface PlanSupportPolicy {
  supportMode: SupportMode;
  hasPrioritySupport: boolean;
  targetFirstResponseBusinessHours: number;
  targetResolutionLabel: string;
  includesAssistedOnboarding: boolean;
  includesAssistedMigration: boolean;
}
