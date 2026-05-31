/**
 * Type-safe fixtures for the rich customer-success payloads, shared by the
 * backoffice unit tests. Building a full `OrganizationQueueItem` /
 * `SupportRequest` by hand is verbose; these factories provide complete,
 * overridable defaults so tests stay focused on the fields they exercise.
 */
import type {
  HealthStatus,
  MigrationStatus,
  OnboardingStatus,
  Operator,
  OrganizationQueueItem,
  SupportRequest,
  SupportRequestStatus,
  SupportSlaStatus,
  WorkflowPolicy,
  WorkflowSummary,
} from './model'

const policy: WorkflowPolicy = {
  supportMode: 'standard',
  effectiveSlaTier: 'PLAN_DEFAULT',
  prioritySupport: false,
  targetFirstResponseBusinessHours: 8,
  dueSoonThresholdBusinessHours: 4,
  includesAssistedOnboarding: false,
  includesAssistedMigration: false,
  requiresInternalOwnerForActiveWorkflows: true,
  requiresNextActionForActiveWorkflows: true,
}

const baseWorkflow: WorkflowSummary = {
  accountOwnershipStatus: 'ASSIGNED',
  onboardingState: 'INACTIVE',
  migrationState: 'INACTIVE',
  supportState: 'IDLE',
  goLiveState: 'INACTIVE',
  hasActiveDeliveryWorkflows: false,
  hasActiveSupportWorkflow: false,
  hasActiveWorkflows: false,
  warnings: [],
  violations: [],
  policy,
}

export const testOperator: Operator = {
  id: 'op-1',
  name: 'Operator',
  email: 'op@calibra',
  role: 'platform_operator',
}

export type QueueAccountOverrides = {
  id?: string
  name?: string
  slug?: string
  health?: HealthStatus
  needsAttention?: boolean
  needsEscalation?: boolean
  nextActionOverdue?: boolean
  nextActionStatus?: OrganizationQueueItem['operationalSummary']['nextActionStatus']
  activeBlockersCount?: number
  breachedRequestsCount?: number
  openRequestsCount?: number
  hasInternalOwner?: boolean
  hasActiveWorkflows?: boolean
  prioritySupport?: boolean
  attentionScore?: number
  onboardingStatus?: OnboardingStatus
  migrationStatus?: MigrationStatus
  onboardingState?: WorkflowSummary['onboardingState']
  migrationState?: WorkflowSummary['migrationState']
  supportState?: WorkflowSummary['supportState']
  accountOwnershipStatus?: WorkflowSummary['accountOwnershipStatus']
  internalOwner?: Operator | null
  accountOwnerName?: string | null
}

export function makeQueueAccount(
  overrides: QueueAccountOverrides = {},
): OrganizationQueueItem {
  const health = overrides.health ?? 'HEALTHY'
  const workflow: WorkflowSummary = {
    ...baseWorkflow,
    onboardingState: overrides.onboardingState ?? 'INACTIVE',
    migrationState: overrides.migrationState ?? 'INACTIVE',
    supportState: overrides.supportState ?? 'IDLE',
    accountOwnershipStatus: overrides.accountOwnershipStatus ?? 'ASSIGNED',
    hasActiveWorkflows: overrides.hasActiveWorkflows ?? false,
    hasActiveDeliveryWorkflows: overrides.hasActiveWorkflows ?? false,
  }

  return {
    id: overrides.id ?? 'org-1',
    name: overrides.name ?? 'Lab',
    slug: overrides.slug ?? 'lab',
    type: 'LAB',
    accountOwnerName: overrides.accountOwnerName ?? null,
    accountOwnerEmail: null,
    supportContactEmail: null,
    internalOwnerUser:
      overrides.internalOwner ??
      (overrides.hasInternalOwner === false ? null : testOperator),
    profile: {
      onboardingStatus: overrides.onboardingStatus ?? 'NOT_STARTED',
      migrationStatus: overrides.migrationStatus ?? 'NOT_REQUIRED',
      goLiveStatus: 'NOT_SCHEDULED',
      healthStatus: health,
      nextAction: null,
      nextActionDueAt: null,
      nextActionCompletedAt: null,
      lastTouchedAt: null,
      goLiveTargetDate: null,
      goLiveActualDate: null,
      prioritySupport: overrides.prioritySupport ?? false,
      slaTier: 'PLAN_DEFAULT',
      blockers: [],
    },
    supportPolicy: {
      supportMode: 'standard',
      hasPrioritySupport: overrides.prioritySupport ?? false,
      targetFirstResponseBusinessHours: 8,
      targetResolutionLabel: '8h úteis',
      includesAssistedOnboarding: false,
      includesAssistedMigration: false,
    },
    plan: { id: 'FREE', name: 'Free', status: 'ACTIVE' },
    operationalSummary: {
      supportMode: 'standard',
      effectiveSlaTier: 'PLAN_DEFAULT',
      prioritySupport: overrides.prioritySupport ?? false,
      healthStatus: health,
      goLiveStatus: 'NOT_SCHEDULED',
      workstreams: [],
      openRequestsCount: overrides.openRequestsCount ?? 0,
      urgentRequestsCount: 0,
      dueSoonRequestsCount: 0,
      breachedRequestsCount: overrides.breachedRequestsCount ?? 0,
      escalatedRequestsCount: 0,
      totalRequestsCount: 0,
      needsAttention: overrides.needsAttention ?? false,
      needsEscalation: overrides.needsEscalation ?? false,
      attentionScore: overrides.attentionScore ?? 0,
      nextActionStatus: overrides.nextActionStatus ?? 'NONE',
      nextActionOverdue: overrides.nextActionOverdue ?? false,
      activeBlockersCount: overrides.activeBlockersCount ?? 0,
      activeBlockerScopes: [],
      blockers: [],
      workflowDelays: {
        hasBlockedWorkflow: false,
        goLiveAtRisk: false,
        nextActionOverdue: overrides.nextActionOverdue ?? false,
        nextActionDueSoon: false,
      },
      hasInternalOwner: overrides.hasInternalOwner ?? true,
      workflow,
      workflowWarnings: [],
      workflowViolations: [],
      policy,
    },
    workflow,
    workflowWarnings: [],
    workflowViolations: [],
    policy,
  }
}

export function makeSupportRequest(overrides: {
  id?: number
  status?: SupportRequestStatus
  slaStatus?: SupportSlaStatus
  assigned?: boolean
  needsEscalation?: boolean
  attentionScore?: number
  organizationId?: string | null
}): SupportRequest {
  const organizationId =
    overrides.organizationId === undefined ? 'org-1' : overrides.organizationId

  return {
    id: overrides.id ?? 1,
    subject: 'Ticket',
    description: null,
    category: 'GENERAL',
    status: overrides.status ?? 'OPEN',
    priority: 'NORMAL',
    slaStatus: overrides.slaStatus ?? 'ON_TRACK',
    timeToSlaMs: null,
    needsEscalation: overrides.needsEscalation ?? false,
    escalationReason: null,
    organizationHealth: 'HEALTHY',
    attentionScore: overrides.attentionScore ?? 0,
    organization: organizationId
      ? { id: organizationId, name: 'Lab', slug: 'lab' }
      : null,
    assignedToUser: overrides.assigned ? testOperator : null,
    events: [],
  }
}
