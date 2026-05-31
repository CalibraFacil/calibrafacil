export type OnboardingStatus =
  | 'NOT_STARTED'
  | 'DISCOVERY'
  | 'CONFIGURATION'
  | 'TRAINING'
  | 'LIVE'
  | 'BLOCKED'

export type MigrationStatus =
  | 'NOT_REQUIRED'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'VALIDATION'
  | 'COMPLETED'
  | 'BLOCKED'

export type GoLiveStatus = 'NOT_SCHEDULED' | 'SCHEDULED' | 'AT_RISK' | 'LIVE'

export type SupportPolicy = {
  supportMode: 'standard' | 'priority' | 'dedicated'
  hasPrioritySupport: boolean
  targetFirstResponseBusinessHours: number
  targetResolutionLabel: string
  includesAssistedOnboarding: boolean
  includesAssistedMigration: boolean
}

export type WorkflowState =
  | 'INACTIVE'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'AT_RISK'
  | 'COMPLETED'
export type SupportWorkflowState = 'IDLE' | 'ACTIVE' | 'AT_RISK' | 'ESCALATED'
export type AccountOwnershipStatus = 'UNASSIGNED' | 'ASSIGNED' | 'AT_RISK'
export type WorkflowWarningCode =
  | 'ACTIVE_BLOCKERS'
  | 'GO_LIVE_AT_RISK'
  | 'ONBOARDING_NOT_INCLUDED_IN_PLAN'
  | 'MIGRATION_NOT_INCLUDED_IN_PLAN'
  | 'NEXT_ACTION_DUE_SOON'
  | 'NEXT_ACTION_OVERDUE'
  | 'SLA_DUE_SOON'
  | 'SLA_BREACHED'
  | 'ESCALATION_REQUIRED'
export type WorkflowViolationCode =
  | 'MISSING_INTERNAL_OWNER'
  | 'MISSING_NEXT_ACTION'

export type WorkflowIssue<TCode extends string> = {
  code: TCode
  message: string
}

export type WorkflowPolicy = {
  supportMode: SupportPolicy['supportMode']
  effectiveSlaTier: 'PLAN_DEFAULT' | 'PRIORITY' | 'DEDICATED'
  prioritySupport: boolean
  targetFirstResponseBusinessHours: number
  dueSoonThresholdBusinessHours: number
  includesAssistedOnboarding: boolean
  includesAssistedMigration: boolean
  requiresInternalOwnerForActiveWorkflows: boolean
  requiresNextActionForActiveWorkflows: boolean
}

export type WorkflowSummary = {
  accountOwnershipStatus: AccountOwnershipStatus
  onboardingState: WorkflowState
  migrationState: WorkflowState
  supportState: SupportWorkflowState
  goLiveState: WorkflowState
  hasActiveDeliveryWorkflows: boolean
  hasActiveSupportWorkflow: boolean
  hasActiveWorkflows: boolean
  warnings: WorkflowIssue<WorkflowWarningCode>[]
  violations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
}

export type SuccessProfileResponse = {
  profile: {
    id: number
    organizationId: string
    accountOwnerName: string | null
    accountOwnerEmail: string | null
    internalOwnerName: string | null
    internalOwnerEmail: string | null
    supportContactEmail: string | null
    onboardingStatus: OnboardingStatus
    migrationStatus: MigrationStatus
    goLiveStatus: GoLiveStatus
    goLiveTargetDate: string | null
    goLiveActualDate: string | null
    publicStatusNote: string | null
    internalNotes: string | null
  }
  publicSummary: {
    healthStatus: 'HEALTHY' | 'ATTENTION' | 'CRITICAL'
    onboardingStatus: OnboardingStatus
    migrationStatus: MigrationStatus
    goLiveStatus: GoLiveStatus
    nextActionStatus: 'NONE' | 'PENDING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED'
    hasActiveBlockers: boolean
  }
  supportPolicy: SupportPolicy
  plan: {
    id: string
    name: string
    status: string
  }
  workflow: WorkflowSummary
  workflowWarnings: WorkflowIssue<WorkflowWarningCode>[]
  workflowViolations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
}

export type SupportRequest = {
  id: number
  category: string
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED'
  subject: string
  description: string
  publicResponse: string | null
  slaTargetAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  slaStatus: 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'RESOLVED'
  timeToSlaMs: number | null
  prioritySupport: boolean
  createdAt: string
  requestedByUser: {
    id: string
    name: string
    email: string
  } | null
  assignedToUser: {
    id: string
    name: string
    email: string
  } | null
  events: Array<{
    id?: number
    kind: string
    message: string
    publicVisible: boolean
    createdAt: string
    actorUser: {
      id: string
      name: string
      email: string
    } | null
  }>
}

export type SupportRequestsResponse = {
  data: SupportRequest[]
}
