import type { InferResponseType } from 'hono/client'

import { api } from '@/utils/api'

export type HealthStatus = 'HEALTHY' | 'ATTENTION' | 'CRITICAL'
export type GoLiveStatus = 'NOT_SCHEDULED' | 'SCHEDULED' | 'AT_RISK' | 'LIVE'
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
export type SlaTier = 'PLAN_DEFAULT' | 'PRIORITY' | 'DEDICATED'
export type NextActionStatus =
  | 'NONE'
  | 'PENDING'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'COMPLETED'
export type BlockerScope = 'ONBOARDING' | 'MIGRATION' | 'GO_LIVE' | 'SUPPORT'
export type SupportRequestStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
export type SupportPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type SupportSlaStatus = 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'RESOLVED'
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

export type Operator = {
  id: string
  name: string
  email: string
  role: string
}

export type WorkflowIssue<TCode extends string> = {
  code: TCode
  message: string
}

export type Blocker = {
  id: string
  scope: BlockerScope
  status: 'ACTIVE' | 'RESOLVED'
  reason: string
  createdAt: string
  createdByUserId: string | null
  resolvedAt: string | null
  resolvedByUserId: string | null
}

export type WorkflowPolicy = {
  supportMode: 'standard' | 'priority' | 'dedicated'
  effectiveSlaTier: SlaTier
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

export type OrganizationQueueItem = {
  id: string
  name: string
  slug: string
  type: string | null
  accountOwnerName: string | null
  accountOwnerEmail: string | null
  supportContactEmail: string | null
  internalOwnerUser: Operator | null
  profile: {
    onboardingStatus: OnboardingStatus
    migrationStatus: MigrationStatus
    goLiveStatus: GoLiveStatus
    healthStatus: HealthStatus
    nextAction: string | null
    nextActionDueAt: string | null
    nextActionCompletedAt: string | null
    lastTouchedAt: string | null
    goLiveTargetDate: string | null
    goLiveActualDate: string | null
    prioritySupport: boolean
    slaTier: SlaTier
    blockers: Blocker[]
  }
  supportPolicy: {
    supportMode: string
    hasPrioritySupport: boolean
    targetFirstResponseBusinessHours: number
    targetResolutionLabel: string
    includesAssistedOnboarding: boolean
    includesAssistedMigration: boolean
  }
  plan: {
    id: string
    name: string
    status: string
  }
  operationalSummary: {
    supportMode: string
    effectiveSlaTier: SlaTier
    prioritySupport: boolean
    healthStatus: HealthStatus
    goLiveStatus: GoLiveStatus
    workstreams: string[]
    openRequestsCount: number
    urgentRequestsCount: number
    dueSoonRequestsCount: number
    breachedRequestsCount: number
    escalatedRequestsCount: number
    totalRequestsCount: number
    needsAttention: boolean
    needsEscalation: boolean
    attentionScore: number
    nextActionStatus: NextActionStatus
    nextActionOverdue: boolean
    activeBlockersCount: number
    activeBlockerScopes: BlockerScope[]
    blockers: Blocker[]
    workflowDelays: {
      hasBlockedWorkflow: boolean
      goLiveAtRisk: boolean
      nextActionOverdue: boolean
      nextActionDueSoon: boolean
    }
    hasInternalOwner: boolean
    workflow: WorkflowSummary
    workflowWarnings: WorkflowIssue<WorkflowWarningCode>[]
    workflowViolations: WorkflowIssue<WorkflowViolationCode>[]
    policy: WorkflowPolicy
  }
  workflow: WorkflowSummary
  workflowWarnings: WorkflowIssue<WorkflowWarningCode>[]
  workflowViolations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
}

export type ProfilePayload = {
  organization: {
    id: string
    name: string
    slug: string
  }
  profile: {
    id: number
    accountOwnerUserId: string | null
    accountOwnerName: string | null
    accountOwnerEmail: string | null
    supportContactEmail: string | null
    internalOwnerUserId: string | null
    prioritySupport: boolean
    slaTier: SlaTier
    onboardingStatus: OnboardingStatus
    migrationStatus: MigrationStatus
    goLiveStatus: GoLiveStatus
    healthStatus: HealthStatus
    nextAction: string | null
    nextActionDueAt: string | null
    nextActionCompletedAt: string | null
    goLiveTargetDate: string | null
    goLiveActualDate: string | null
    publicStatusNote: string | null
    internalNotes: string | null
    blockers: Blocker[]
  }
  supportPolicy: OrganizationQueueItem['supportPolicy']
  plan: OrganizationQueueItem['plan']
  internalOwnerUser: Operator | null
  operators: Operator[]
  operationalSummary: OrganizationQueueItem['operationalSummary']
  workflow: WorkflowSummary
  workflowWarnings: WorkflowIssue<WorkflowWarningCode>[]
  workflowViolations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
  timeline: Array<{
    id: number
    action: string
    entityType: string
    entityId: string | null
    details: Record<string, unknown> | null
    createdAt: string
    actorUser: { id: string; name: string; email: string | null } | null
  }>
}

export type ProfileDraft = {
  accountOwnerName: string
  accountOwnerEmail: string
  supportContactEmail: string
  internalOwnerUserId: string
  prioritySupport: boolean
  slaTier: SlaTier
  onboardingStatus: OnboardingStatus
  migrationStatus: MigrationStatus
  goLiveStatus: GoLiveStatus
  healthStatus: HealthStatus
  nextAction: string
  nextActionDueAt: string
  goLiveTargetDate: string
  goLiveActualDate: string
  publicStatusNote: string
  internalNotes: string
}

export type RequestsPayload = InferResponseType<
  (typeof api.api.backoffice)['customer-success']['organizations'][':id']['requests']['$get'],
  200
>
export type SupportQueueResponse = InferResponseType<
  typeof api.api.backoffice.support.queue.$get,
  200
>
export type SupportQueueItem = SupportQueueResponse['data'][number]

export type OrganizationFilter =
  | 'all'
  | 'attention'
  | 'critical'
  | 'priority'
  | 'onboarding'
  | 'migration'
  | 'overdue'
  | 'unassigned'
  | 'escalation'
export type TicketFilter =
  | 'all'
  | 'breached'
  | 'due'
  | 'open'
  | 'mine'
  | 'waiting'
  | 'unassigned'
  | 'escalation'

export type AccountBoardItem = {
  id: string
  name: string
  column: HealthStatus
  organizationId: string
  organization: OrganizationQueueItem
}
export type AccountBoardColumn = {
  id: HealthStatus
  name: string
  description: string
}
export type SupportBoardItem = {
  id: string
  name: string
  column: SupportRequestStatus
  requestId: number
  request: SupportQueueItem
}
export type SupportBoardColumn = {
  id: SupportRequestStatus
  name: string
  description: string
}

export const DEFAULT_PROFILE_DRAFT: ProfileDraft = {
  accountOwnerName: '',
  accountOwnerEmail: '',
  supportContactEmail: '',
  internalOwnerUserId: '',
  prioritySupport: false,
  slaTier: 'PLAN_DEFAULT',
  onboardingStatus: 'NOT_STARTED',
  migrationStatus: 'NOT_REQUIRED',
  goLiveStatus: 'NOT_SCHEDULED',
  healthStatus: 'HEALTHY',
  nextAction: '',
  nextActionDueAt: '',
  goLiveTargetDate: '',
  goLiveActualDate: '',
  publicStatusNote: '',
  internalNotes: '',
}

export const onboardingLabels: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'Não iniciado',
  DISCOVERY: 'Discovery',
  CONFIGURATION: 'Configuração',
  TRAINING: 'Treinamento',
  LIVE: 'Em produção',
  BLOCKED: 'Bloqueado',
}

export const migrationLabels: Record<MigrationStatus, string> = {
  NOT_REQUIRED: 'Não necessário',
  PLANNING: 'Planejamento',
  IN_PROGRESS: 'Em andamento',
  VALIDATION: 'Validação',
  COMPLETED: 'Concluído',
  BLOCKED: 'Bloqueado',
}

export const goLiveLabels: Record<GoLiveStatus, string> = {
  NOT_SCHEDULED: 'Sem data',
  SCHEDULED: 'Agendado',
  AT_RISK: 'Em risco',
  LIVE: 'Em produção',
}

export const healthLabels: Record<HealthStatus, string> = {
  HEALTHY: 'Saudável',
  ATTENTION: 'Atenção',
  CRITICAL: 'Crítico',
}

export const slaTierLabels: Record<SlaTier, string> = {
  PLAN_DEFAULT: 'Plano',
  PRIORITY: 'Prioritário',
  DEDICATED: 'Dedicado',
}

export const nextActionStatusLabels: Record<NextActionStatus, string> = {
  NONE: 'Sem ação',
  PENDING: 'Pendente',
  DUE_SOON: 'Vencendo',
  OVERDUE: 'Atrasada',
  COMPLETED: 'Concluída',
}

export const workflowStateLabels: Record<WorkflowState, string> = {
  INACTIVE: 'Inativo',
  ACTIVE: 'Ativo',
  BLOCKED: 'Bloqueado',
  AT_RISK: 'Em risco',
  COMPLETED: 'Concluído',
}

export const supportWorkflowStateLabels: Record<SupportWorkflowState, string> =
  {
    IDLE: 'Sem fila ativa',
    ACTIVE: 'Em operação',
    AT_RISK: 'Exige atenção',
    ESCALATED: 'Escalado',
  }

export const ownershipStatusLabels: Record<AccountOwnershipStatus, string> = {
  UNASSIGNED: 'Sem owner',
  ASSIGNED: 'Owner definido',
  AT_RISK: 'Owner obrigatório ausente',
}

export const blockerScopeLabels: Record<BlockerScope, string> = {
  ONBOARDING: 'Onboarding',
  MIGRATION: 'Migração',
  GO_LIVE: 'Go-live',
  SUPPORT: 'Suporte',
}

export const requestStatusLabels: Record<SupportRequestStatus, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  WAITING_ON_CUSTOMER: 'Aguardando laboratório',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
}

export const requestPriorityLabels: Record<SupportPriority, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const slaStatusLabels: Record<SupportSlaStatus, string> = {
  ON_TRACK: 'Dentro do SLA',
  DUE_SOON: 'SLA vencendo',
  BREACHED: 'SLA violado',
  RESOLVED: 'Resolvido',
}

export const accountBoardColumns: AccountBoardColumn[] = [
  {
    id: 'CRITICAL',
    name: 'Crítico',
    description: 'Bloqueio, SLA rompido ou risco imediato.',
  },
  {
    id: 'ATTENTION',
    name: 'Atenção',
    description: 'Exige owner, resposta ou próxima ação.',
  },
  {
    id: 'HEALTHY',
    name: 'Saudável',
    description: 'Operação sob controle e monitorada.',
  },
]

export const supportBoardColumns: SupportBoardColumn[] = [
  {
    id: 'OPEN',
    name: 'Entrada',
    description: 'Aguardando triagem e dono.',
  },
  {
    id: 'IN_PROGRESS',
    name: 'Em andamento',
    description: 'Tratamento ativo pela operação.',
  },
  {
    id: 'WAITING_ON_CUSTOMER',
    name: 'Aguardando cliente',
    description: 'Depende de retorno do laboratório.',
  },
  {
    id: 'RESOLVED',
    name: 'Resolvidos',
    description: 'Entregues e prontos para fechar.',
  },
  {
    id: 'CLOSED',
    name: 'Fechados',
    description: 'Fora do fluxo corrente.',
  },
]

export async function parseApiError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null)

  if (data && typeof data === 'object') {
    if ('error' in data && typeof data.error === 'string') return data.error
    if ('message' in data && typeof data.message === 'string')
      return data.message
  }

  return fallback
}

export function formatDateTime(value: string | null) {
  if (!value) return 'Não definido'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatDateOnly(value: string | null) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

export function formatRelativeSla(value: number | null) {
  if (value === null) return 'Sem SLA definido'

  const absoluteHours = Math.round(Math.abs(value) / (60 * 60 * 1000))
  if (value <= 0) return `${absoluteHours}h em atraso`
  if (absoluteHours < 24) return `${absoluteHours}h restantes`

  return `${Math.round(absoluteHours / 24)}d restantes`
}

export function createProfileDraft(payload: ProfilePayload): ProfileDraft {
  return {
    accountOwnerName: payload.profile.accountOwnerName ?? '',
    accountOwnerEmail: payload.profile.accountOwnerEmail ?? '',
    supportContactEmail: payload.profile.supportContactEmail ?? '',
    internalOwnerUserId: payload.profile.internalOwnerUserId ?? '',
    prioritySupport: payload.profile.prioritySupport,
    slaTier: payload.profile.slaTier,
    onboardingStatus: payload.profile.onboardingStatus,
    migrationStatus: payload.profile.migrationStatus,
    goLiveStatus: payload.profile.goLiveStatus,
    healthStatus: payload.profile.healthStatus,
    nextAction: payload.profile.nextAction ?? '',
    nextActionDueAt: formatDateOnly(payload.profile.nextActionDueAt),
    goLiveTargetDate: formatDateOnly(payload.profile.goLiveTargetDate),
    goLiveActualDate: formatDateOnly(payload.profile.goLiveActualDate),
    publicStatusNote: payload.profile.publicStatusNote ?? '',
    internalNotes: payload.profile.internalNotes ?? '',
  }
}

export function getHealthBadgeVariant(
  status: HealthStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'CRITICAL':
      return 'destructive'
    case 'ATTENTION':
      return 'default'
    default:
      return 'outline'
  }
}

export function getSlaBadgeVariant(
  status: SupportSlaStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'BREACHED':
      return 'destructive'
    case 'DUE_SOON':
      return 'default'
    case 'RESOLVED':
      return 'secondary'
    default:
      return 'outline'
  }
}

export function getPriorityBadgeVariant(
  priority: SupportPriority,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (priority) {
    case 'URGENT':
      return 'destructive'
    case 'HIGH':
      return 'default'
    case 'LOW':
      return 'outline'
    default:
      return 'secondary'
  }
}

export function getNextActionBadgeVariant(
  status: NextActionStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'OVERDUE':
      return 'destructive'
    case 'DUE_SOON':
      return 'default'
    case 'COMPLETED':
      return 'secondary'
    default:
      return 'outline'
  }
}

export function getWorkflowBadgeVariant(
  status: WorkflowState | SupportWorkflowState | AccountOwnershipStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'BLOCKED':
    case 'AT_RISK':
    case 'ESCALATED':
      return 'destructive'
    case 'ACTIVE':
      return 'default'
    case 'COMPLETED':
    case 'ASSIGNED':
      return 'secondary'
    default:
      return 'outline'
  }
}
