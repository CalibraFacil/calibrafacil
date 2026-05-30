/**
 * Backoffice console — the single source of truth for operational status.
 *
 * Every domain enum surfaced in the backoffice (health, SLA, onboarding,
 * migration, go-live, next-action, support status & priority, workflow and
 * ownership state) maps to a `{ label, tone }` descriptor here. Labels are
 * re-exported from the customer-success model so there is exactly one
 * Portuguese vocabulary, and `tone` reuses the instrument-panel `SignalTone`
 * scale so a status renders the same color everywhere it appears.
 *
 * Components must never hand-pick a color for a status — they read it from a
 * descriptor function below. That keeps status semantics correct in one place.
 */
import type { SignalTone } from '@/components/instrument-panel'
import {
  blockerScopeLabels,
  goLiveLabels,
  healthLabels,
  migrationLabels,
  nextActionStatusLabels,
  onboardingLabels,
  ownershipStatusLabels,
  requestPriorityLabels,
  requestStatusLabels,
  slaStatusLabels,
  slaTierLabels,
  supportWorkflowStateLabels,
  workflowStateLabels,
  type AccountOwnershipStatus,
  type BlockerScope,
  type GoLiveStatus,
  type HealthStatus,
  type MigrationStatus,
  type NextActionStatus,
  type OnboardingStatus,
  type SlaTier,
  type SupportPriority,
  type SupportRequestStatus,
  type SupportSlaStatus,
  type SupportWorkflowState,
  type WorkflowState,
} from '../customer-success/model'

export type StatusDescriptor = {
  label: string
  tone: SignalTone
}

const healthTone: Record<HealthStatus, SignalTone> = {
  HEALTHY: 'ok',
  ATTENTION: 'warning',
  CRITICAL: 'critical',
}

const goLiveTone: Record<GoLiveStatus, SignalTone> = {
  NOT_SCHEDULED: 'neutral',
  SCHEDULED: 'info',
  AT_RISK: 'warning',
  LIVE: 'ok',
}

const onboardingTone: Record<OnboardingStatus, SignalTone> = {
  NOT_STARTED: 'neutral',
  DISCOVERY: 'info',
  CONFIGURATION: 'info',
  TRAINING: 'info',
  LIVE: 'ok',
  BLOCKED: 'critical',
}

const migrationTone: Record<MigrationStatus, SignalTone> = {
  NOT_REQUIRED: 'neutral',
  PLANNING: 'info',
  IN_PROGRESS: 'info',
  VALIDATION: 'info',
  COMPLETED: 'ok',
  BLOCKED: 'critical',
}

const slaTierTone: Record<SlaTier, SignalTone> = {
  PLAN_DEFAULT: 'neutral',
  PRIORITY: 'info',
  DEDICATED: 'info',
}

const nextActionTone: Record<NextActionStatus, SignalTone> = {
  NONE: 'neutral',
  PENDING: 'info',
  DUE_SOON: 'warning',
  OVERDUE: 'critical',
  COMPLETED: 'ok',
}

const supportSlaTone: Record<SupportSlaStatus, SignalTone> = {
  ON_TRACK: 'ok',
  DUE_SOON: 'warning',
  BREACHED: 'critical',
  RESOLVED: 'neutral',
}

const supportPriorityTone: Record<SupportPriority, SignalTone> = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'warning',
  URGENT: 'critical',
}

const requestStatusTone: Record<SupportRequestStatus, SignalTone> = {
  OPEN: 'info',
  IN_PROGRESS: 'info',
  WAITING_ON_CUSTOMER: 'warning',
  RESOLVED: 'ok',
  CLOSED: 'neutral',
}

const workflowTone: Record<WorkflowState, SignalTone> = {
  INACTIVE: 'neutral',
  ACTIVE: 'info',
  BLOCKED: 'critical',
  AT_RISK: 'warning',
  COMPLETED: 'ok',
}

const supportWorkflowTone: Record<SupportWorkflowState, SignalTone> = {
  IDLE: 'neutral',
  ACTIVE: 'info',
  AT_RISK: 'warning',
  ESCALATED: 'critical',
}

const ownershipTone: Record<AccountOwnershipStatus, SignalTone> = {
  UNASSIGNED: 'warning',
  ASSIGNED: 'ok',
  AT_RISK: 'critical',
}

const blockerScopeTone: Record<BlockerScope, SignalTone> = {
  ONBOARDING: 'warning',
  MIGRATION: 'warning',
  GO_LIVE: 'warning',
  SUPPORT: 'critical',
}

export function healthStatus(value: HealthStatus): StatusDescriptor {
  return { label: healthLabels[value], tone: healthTone[value] }
}

export function goLiveStatus(value: GoLiveStatus): StatusDescriptor {
  return { label: goLiveLabels[value], tone: goLiveTone[value] }
}

export function onboardingStatus(value: OnboardingStatus): StatusDescriptor {
  return { label: onboardingLabels[value], tone: onboardingTone[value] }
}

export function migrationStatus(value: MigrationStatus): StatusDescriptor {
  return { label: migrationLabels[value], tone: migrationTone[value] }
}

export function slaTier(value: SlaTier): StatusDescriptor {
  return { label: slaTierLabels[value], tone: slaTierTone[value] }
}

export function nextActionStatus(value: NextActionStatus): StatusDescriptor {
  return { label: nextActionStatusLabels[value], tone: nextActionTone[value] }
}

export function supportSlaStatus(value: SupportSlaStatus): StatusDescriptor {
  return { label: slaStatusLabels[value], tone: supportSlaTone[value] }
}

export function supportPriority(value: SupportPriority): StatusDescriptor {
  return {
    label: requestPriorityLabels[value],
    tone: supportPriorityTone[value],
  }
}

export function requestStatus(value: SupportRequestStatus): StatusDescriptor {
  return { label: requestStatusLabels[value], tone: requestStatusTone[value] }
}

export function workflowState(value: WorkflowState): StatusDescriptor {
  return { label: workflowStateLabels[value], tone: workflowTone[value] }
}

export function supportWorkflowState(
  value: SupportWorkflowState,
): StatusDescriptor {
  return {
    label: supportWorkflowStateLabels[value],
    tone: supportWorkflowTone[value],
  }
}

export function ownershipStatus(
  value: AccountOwnershipStatus,
): StatusDescriptor {
  return { label: ownershipStatusLabels[value], tone: ownershipTone[value] }
}

export function blockerScope(value: BlockerScope): StatusDescriptor {
  return { label: blockerScopeLabels[value], tone: blockerScopeTone[value] }
}
