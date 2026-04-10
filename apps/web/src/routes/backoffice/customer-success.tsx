import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'

import { useBackofficeSession } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/backoffice/customer-success')({
  head: () => ({
    meta: [{ title: 'Backoffice | Customer Success | CalibraFácil' }],
  }),
  component: InternalCustomerSuccessPage,
})

type HealthStatus = 'HEALTHY' | 'ATTENTION' | 'CRITICAL'
type GoLiveStatus = 'NOT_SCHEDULED' | 'SCHEDULED' | 'AT_RISK' | 'LIVE'
type OnboardingStatus =
  | 'NOT_STARTED'
  | 'DISCOVERY'
  | 'CONFIGURATION'
  | 'TRAINING'
  | 'LIVE'
  | 'BLOCKED'
type MigrationStatus =
  | 'NOT_REQUIRED'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'VALIDATION'
  | 'COMPLETED'
  | 'BLOCKED'
type SlaTier = 'PLAN_DEFAULT' | 'PRIORITY' | 'DEDICATED'
type NextActionStatus = 'NONE' | 'PENDING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED'
type BlockerScope = 'ONBOARDING' | 'MIGRATION' | 'GO_LIVE' | 'SUPPORT'
type SupportRequestStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
type SupportPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
type SupportSlaStatus = 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'RESOLVED'
type WorkflowState = 'INACTIVE' | 'ACTIVE' | 'BLOCKED' | 'AT_RISK' | 'COMPLETED'
type SupportWorkflowState = 'IDLE' | 'ACTIVE' | 'AT_RISK' | 'ESCALATED'
type AccountOwnershipStatus = 'UNASSIGNED' | 'ASSIGNED' | 'AT_RISK'
type WorkflowWarningCode =
  | 'ACTIVE_BLOCKERS'
  | 'GO_LIVE_AT_RISK'
  | 'ONBOARDING_NOT_INCLUDED_IN_PLAN'
  | 'MIGRATION_NOT_INCLUDED_IN_PLAN'
  | 'NEXT_ACTION_DUE_SOON'
  | 'NEXT_ACTION_OVERDUE'
  | 'SLA_DUE_SOON'
  | 'SLA_BREACHED'
  | 'ESCALATION_REQUIRED'
type WorkflowViolationCode = 'MISSING_INTERNAL_OWNER' | 'MISSING_NEXT_ACTION'
type Blocker = {
  id: string
  scope: BlockerScope
  status: 'ACTIVE' | 'RESOLVED'
  reason: string
  createdAt: string
  createdByUserId: string | null
  resolvedAt: string | null
  resolvedByUserId: string | null
}

type Operator = {
  id: string
  name: string
  email: string
  role: string
}

type WorkflowIssue<TCode extends string> = {
  code: TCode
  message: string
}

type WorkflowPolicy = {
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

type WorkflowSummary = {
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

type OrganizationQueueItem = {
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

type ProfilePayload = {
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

type ProfileDraft = {
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

type SupportRequest = {
  id: number
  category: string
  priority: SupportPriority
  status: SupportRequestStatus
  subject: string
  description: string
  publicResponse: string | null
  createdAt: string
  slaTargetAt: string | null
  slaStatus: SupportSlaStatus
  timeToSlaMs: number | null
  prioritySupport: boolean
  requestedByUser: { id?: string; name: string; email: string } | null
  assignedToUser: { id: string; name: string; email: string } | null
  escalatedAt?: string | null
  escalationReason?: string | null
  needsEscalation?: boolean
  attentionScore?: number
  events: Array<{
    kind: string
    message: string
    publicVisible: boolean
    createdAt: string
    actorUser: { name: string; email: string } | null
  }>
}

type RequestsPayload = {
  organization: {
    id: string
    name: string
    slug: string
  }
  operationalSummary: OrganizationQueueItem['operationalSummary']
  workflow: WorkflowSummary
  workflowWarnings: WorkflowIssue<WorkflowWarningCode>[]
  workflowViolations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
  data: SupportRequest[]
}

type SupportQueueItem = SupportRequest & {
  organization: { id: string; name: string; slug: string } | null
  organizationHealth: HealthStatus
  effectiveSlaTier: SlaTier
  prioritySupport: boolean
  needsEscalation: boolean
  attentionScore: number
  escalationReason: string | null
  nextActionStatus: NextActionStatus
  organizationBlockers: Blocker[]
  workflowDelays: {
    hasBlockedWorkflow: boolean
    goLiveAtRisk: boolean
    nextActionOverdue: boolean
    nextActionDueSoon: boolean
  }
}

const onboardingLabels: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'Não iniciado',
  DISCOVERY: 'Discovery',
  CONFIGURATION: 'Configuração',
  TRAINING: 'Treinamento',
  LIVE: 'Em produção',
  BLOCKED: 'Bloqueado',
}

const DEFAULT_PROFILE_DRAFT: ProfileDraft = {
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

const migrationLabels: Record<MigrationStatus, string> = {
  NOT_REQUIRED: 'Não necessário',
  PLANNING: 'Planejamento',
  IN_PROGRESS: 'Em andamento',
  VALIDATION: 'Validação',
  COMPLETED: 'Concluído',
  BLOCKED: 'Bloqueado',
}

const goLiveLabels: Record<GoLiveStatus, string> = {
  NOT_SCHEDULED: 'Sem data',
  SCHEDULED: 'Agendado',
  AT_RISK: 'Em risco',
  LIVE: 'Em produção',
}

const healthLabels: Record<HealthStatus, string> = {
  HEALTHY: 'Saudável',
  ATTENTION: 'Atenção',
  CRITICAL: 'Crítico',
}

const slaTierLabels: Record<SlaTier, string> = {
  PLAN_DEFAULT: 'Plano',
  PRIORITY: 'Prioritário',
  DEDICATED: 'Dedicado',
}

const nextActionStatusLabels: Record<NextActionStatus, string> = {
  NONE: 'Sem ação',
  PENDING: 'Pendente',
  DUE_SOON: 'Vencendo',
  OVERDUE: 'Atrasada',
  COMPLETED: 'Concluída',
}

const workflowStateLabels: Record<WorkflowState, string> = {
  INACTIVE: 'Inativo',
  ACTIVE: 'Ativo',
  BLOCKED: 'Bloqueado',
  AT_RISK: 'Em risco',
  COMPLETED: 'Concluído',
}

const supportWorkflowStateLabels: Record<SupportWorkflowState, string> = {
  IDLE: 'Sem fila ativa',
  ACTIVE: 'Em operação',
  AT_RISK: 'Exige atenção',
  ESCALATED: 'Escalado',
}

const ownershipStatusLabels: Record<AccountOwnershipStatus, string> = {
  UNASSIGNED: 'Sem owner',
  ASSIGNED: 'Owner definido',
  AT_RISK: 'Owner obrigatório ausente',
}

const blockerScopeLabels: Record<BlockerScope, string> = {
  ONBOARDING: 'Onboarding',
  MIGRATION: 'Migração',
  GO_LIVE: 'Go-live',
  SUPPORT: 'Suporte',
}

const requestStatusLabels: Record<SupportRequestStatus, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  WAITING_ON_CUSTOMER: 'Aguardando laboratório',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
}

const requestPriorityLabels: Record<SupportPriority, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const slaStatusLabels: Record<SupportSlaStatus, string> = {
  ON_TRACK: 'Dentro do SLA',
  DUE_SOON: 'SLA vencendo',
  BREACHED: 'SLA violado',
  RESOLVED: 'Resolvido',
}

async function parseApiError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null)

  if (data && typeof data === 'object') {
    if ('error' in data && typeof data.error === 'string') return data.error
    if ('message' in data && typeof data.message === 'string') return data.message
  }

  return fallback
}

function formatDateTime(value: string | null) {
  if (!value) return 'Não definido'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDateOnly(value: string | null) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

function createProfileDraft(payload: ProfilePayload): ProfileDraft {
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

function formatRelativeSla(value: number | null) {
  if (value === null) return 'Sem SLA definido'

  const absoluteHours = Math.round(Math.abs(value) / (60 * 60 * 1000))
  if (value <= 0) {
    return `${absoluteHours}h em atraso`
  }

  if (absoluteHours < 24) {
    return `${absoluteHours}h restantes`
  }

  return `${Math.round(absoluteHours / 24)}d restantes`
}

function getHealthBadgeVariant(status: HealthStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'CRITICAL':
      return 'destructive'
    case 'ATTENTION':
      return 'default'
    default:
      return 'outline'
  }
}

function getSlaBadgeVariant(status: SupportSlaStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
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

function getPriorityBadgeVariant(priority: SupportPriority): 'default' | 'secondary' | 'destructive' | 'outline' {
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

function getNextActionBadgeVariant(
  status: NextActionStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'OVERDUE':
      return 'destructive'
    case 'DUE_SOON':
      return 'default'
    case 'COMPLETED':
      return 'secondary'
    case 'PENDING':
      return 'outline'
    default:
      return 'outline'
  }
}

function getWorkflowBadgeVariant(
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

function InternalCustomerSuccessPage() {
  const queryClient = useQueryClient()
  const { data: session } = useBackofficeSession()
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [organizationFilter, setOrganizationFilter] = useState<
    | 'all'
    | 'attention'
    | 'critical'
    | 'priority'
    | 'onboarding'
    | 'migration'
    | 'overdue'
    | 'unassigned'
    | 'escalation'
  >('all')
  const [ticketFilter, setTicketFilter] = useState<
    | 'all'
    | 'breached'
    | 'due'
    | 'open'
    | 'mine'
    | 'waiting'
    | 'unassigned'
    | 'escalation'
  >('all')
  const [search, setSearch] = useState('')
  const [profileDraftsByOrganizationId, setProfileDraftsByOrganizationId] =
    useState<Record<string, ProfileDraft>>({})
  const [responseDrafts, setResponseDrafts] = useState<Record<number, string>>({})
  const [blockerScopeDraft, setBlockerScopeDraft] =
    useState<BlockerScope>('ONBOARDING')
  const [blockerReasonDraft, setBlockerReasonDraft] = useState('')

  const accessQuery = useQuery({
    queryKey: ['backoffice', 'access'],
    queryFn: async () => {
      const res = await api.api.backoffice.access.$get()
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Acesso ao backoffice negado'))
      }

      return res.json() as Promise<{ allowed: boolean }>
    },
    retry: false,
  })

  const organizationsQuery = useQuery({
    queryKey: ['backoffice', 'customer-success', 'organizations'],
    queryFn: async () => {
      const res = await api.api.backoffice['customer-success'].organizations.$get()
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao carregar contas'))
      }

      return res.json() as Promise<{ data: OrganizationQueueItem[] }>
    },
    enabled: accessQuery.isSuccess,
  })

  const supportQueueQuery = useQuery({
    queryKey: ['backoffice', 'support', 'queue', 'customer-success'],
    queryFn: async () => {
      const res = await api.api.backoffice.support.queue.$get()
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao carregar fila de tickets'))
      }

      return res.json() as unknown as Promise<{ data: SupportQueueItem[] }>
    },
    enabled: accessQuery.isSuccess,
  })

  const filteredOrganizations = useMemo(() => {
    const items = organizationsQuery.data?.data ?? []
    const normalizedSearch = search.trim().toLowerCase()

    return items.filter((organization) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        organization.name.toLowerCase().includes(normalizedSearch) ||
        organization.slug.toLowerCase().includes(normalizedSearch) ||
        (organization.accountOwnerName ?? '').toLowerCase().includes(normalizedSearch) ||
        (organization.internalOwnerUser?.name ?? '').toLowerCase().includes(normalizedSearch)

      if (!matchesSearch) return false

      switch (organizationFilter) {
        case 'attention':
          return organization.operationalSummary.needsAttention
        case 'critical':
          return organization.operationalSummary.healthStatus === 'CRITICAL'
        case 'priority':
          return organization.operationalSummary.prioritySupport
        case 'onboarding':
          return (
            organization.workflow.onboardingState !== 'INACTIVE' &&
            organization.workflow.onboardingState !== 'COMPLETED'
          )
        case 'migration':
          return (
            organization.workflow.migrationState !== 'INACTIVE' &&
            organization.workflow.migrationState !== 'COMPLETED'
          )
        case 'overdue':
          return (
            organization.operationalSummary.nextActionStatus === 'OVERDUE' ||
            organization.operationalSummary.breachedRequestsCount > 0
          )
        case 'unassigned':
          return organization.workflow.accountOwnershipStatus !== 'ASSIGNED'
        case 'escalation':
          return organization.workflow.supportState === 'ESCALATED'
        default:
          return true
      }
    })
  }, [organizationFilter, organizationsQuery.data, search])

  const effectiveSelectedOrganizationId = filteredOrganizations.some(
    (organization) => organization.id === selectedOrganizationId,
  )
    ? selectedOrganizationId
    : filteredOrganizations[0]?.id ?? ''

  const profileQuery = useQuery({
    queryKey: [
      'backoffice',
      'customer-success',
      'profile',
      effectiveSelectedOrganizationId,
    ],
    queryFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].profile.$get({
          param: { id: effectiveSelectedOrganizationId },
        })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao carregar detalhe da conta'))
      }

      return res.json() as Promise<ProfilePayload>
    },
    enabled: Boolean(effectiveSelectedOrganizationId) && accessQuery.isSuccess,
  })

  const requestsQuery = useQuery({
    queryKey: [
      'backoffice',
      'customer-success',
      'requests',
      effectiveSelectedOrganizationId,
    ],
    queryFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].requests.$get({
          param: { id: effectiveSelectedOrganizationId },
        })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao carregar tickets da conta'))
      }

      return res.json() as Promise<RequestsPayload>
    },
    enabled: Boolean(effectiveSelectedOrganizationId) && accessQuery.isSuccess,
  })
  const profileDraft =
    effectiveSelectedOrganizationId && profileQuery.data
      ? profileDraftsByOrganizationId[effectiveSelectedOrganizationId] ??
        createProfileDraft(profileQuery.data)
      : DEFAULT_PROFILE_DRAFT
  const setProfileDraft = (
    updater: ProfileDraft | ((current: ProfileDraft) => ProfileDraft),
  ) => {
    if (!effectiveSelectedOrganizationId || !profileQuery.data) return

    setProfileDraftsByOrganizationId((current) => {
      const base =
        current[effectiveSelectedOrganizationId] ??
        createProfileDraft(profileQuery.data)
      const nextDraft =
        typeof updater === 'function' ? updater(base) : updater

      return {
        ...current,
        [effectiveSelectedOrganizationId]: nextDraft,
      }
    })
  }

  const refreshCurrentOrganization = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'customer-success', 'organizations'],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'customer-success',
          'profile',
          effectiveSelectedOrganizationId,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'customer-success',
          'requests',
          effectiveSelectedOrganizationId,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'support', 'queue', 'customer-success'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'support', 'queue'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['customer-success', 'profile'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['customer-success', 'requests'],
      }),
    ])
  }

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].profile.$put({
          param: { id: effectiveSelectedOrganizationId },
          json: {
            accountOwnerName: profileDraft.accountOwnerName,
            accountOwnerEmail: profileDraft.accountOwnerEmail || null,
            supportContactEmail: profileDraft.supportContactEmail || null,
            internalOwnerUserId: profileDraft.internalOwnerUserId || null,
            prioritySupport: profileDraft.prioritySupport,
            slaTier: profileDraft.slaTier,
            onboardingStatus: profileDraft.onboardingStatus,
            migrationStatus: profileDraft.migrationStatus,
            goLiveStatus: profileDraft.goLiveStatus,
            healthStatus: profileDraft.healthStatus,
            goLiveTargetDate: profileDraft.goLiveTargetDate
              ? new Date(profileDraft.goLiveTargetDate).toISOString()
              : null,
            goLiveActualDate: profileDraft.goLiveActualDate
              ? new Date(profileDraft.goLiveActualDate).toISOString()
              : null,
            publicStatusNote: profileDraft.publicStatusNote || null,
            internalNotes: profileDraft.internalNotes || null,
          },
        })

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao atualizar perfil operacional'),
        )
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Conta operacional atualizada')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar perfil operacional',
      )
    },
  })

  const nextActionMutation = useMutation({
    mutationFn: async ({
      markCompleted = false,
    }: {
      markCompleted?: boolean
    }) => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id']['next-action'].$post(
          {
            param: { id: effectiveSelectedOrganizationId },
            json: {
              nextAction: markCompleted ? null : profileDraft.nextAction || null,
              nextActionDueAt:
                markCompleted || !profileDraft.nextActionDueAt
                  ? null
                  : new Date(profileDraft.nextActionDueAt).toISOString(),
              markCompleted,
            },
          },
        )

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao atualizar próxima ação'),
        )
      }

      return res.json()
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.markCompleted
          ? 'Próxima ação concluída'
          : 'Próxima ação atualizada',
      )
      if (variables.markCompleted) {
        setProfileDraft((current) => ({
          ...current,
          nextAction: '',
          nextActionDueAt: '',
        }))
      }
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar próxima ação',
      )
    },
  })

  const blockerMutation = useMutation({
    mutationFn: async ({
      scope,
      mode,
    }: {
      scope: BlockerScope
      mode: 'ADD' | 'RESOLVE'
    }) => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].block.$post(
          {
            param: { id: effectiveSelectedOrganizationId },
            json: {
              scope,
              mode,
              reason: mode === 'ADD' ? blockerReasonDraft : undefined,
            },
          },
        )

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar bloqueio'))
      }

      return res.json()
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.mode === 'ADD' ? 'Bloqueio registrado' : 'Bloqueio resolvido',
      )
      if (variables.mode === 'ADD') {
        setBlockerReasonDraft('')
      }
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar bloqueio',
      )
    },
  })

  const respondMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const message = responseDrafts[requestId]?.trim()
      if (!message) {
        throw new Error('Informe uma resposta antes de enviar')
      }

      const res = await api.api.backoffice['customer-success'].requests[':id'].respond.$post(
        {
          param: { id: String(requestId) },
          json: {
            message,
            publicVisible: true,
          },
        },
      )

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao responder'))
      }

      return res.json()
    },
    onSuccess: async (_, requestId) => {
      toast.success(`Resposta enviada para o ticket #${requestId}`)
      setResponseDrafts((current) => ({ ...current, [requestId]: '' }))
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao responder ticket')
    },
  })

  const assignMutation = useMutation({
    mutationFn: async ({
      requestId,
      assignedToUserId,
    }: {
      requestId: number
      assignedToUserId: string | null
    }) => {
      const res = await api.api.backoffice['customer-success'].requests[':id'].assign.$post(
        {
          param: { id: String(requestId) },
          json: { assignedToUserId },
        },
      )

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atribuir ticket'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Atribuição atualizada')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar atribuição',
      )
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      requestId,
      status,
    }: {
      requestId: number
      status: SupportRequestStatus
    }) => {
      const res = await api.api.backoffice['customer-success'].requests[':id'].status.$post(
        {
          param: { id: String(requestId) },
          json: { status },
        },
      )

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar status'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Status atualizado')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao atualizar status')
    },
  })

  const escalateMutation = useMutation({
    mutationFn: async ({
      requestId,
      reason,
    }: {
      requestId: number
      reason: string
    }) => {
      const res =
        await api.api.backoffice['customer-success'].requests[':id'].escalate.$post(
          {
            param: { id: String(requestId) },
            json: { reason },
          },
        )

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao escalar ticket'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Ticket escalado')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao escalar ticket')
    },
  })

  const takeOwnershipMutation = useMutation({
    mutationFn: async () => {
      const userId = session?.user?.id
      if (!userId) {
        throw new Error('Sessão inválida para assumir a conta')
      }

      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].profile.$put({
          param: { id: effectiveSelectedOrganizationId },
          json: {
            internalOwnerUserId: userId,
          },
        })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao assumir a conta'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Conta atribuída ao operador atual')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao assumir a conta')
    },
  })

  const organizationColumns = useMemo<ColumnDef<OrganizationQueueItem>[]>(
    () => [
      {
        id: 'organization',
        accessorFn: (row) => row.name,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Conta" />
        ),
        cell: ({ row }) => {
          const organization = row.original
          const isSelected =
            organization.id === effectiveSelectedOrganizationId

          return (
            <div className="flex min-w-60 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{organization.name}</span>
                {isSelected ? <Badge>Selecionada</Badge> : null}
              </div>
              <span className="text-sm text-muted-foreground">{organization.slug}</span>
            </div>
          )
        },
      },
      {
        id: 'workflow',
        accessorFn: (row) => row.operationalSummary.workstreams.join(','),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Workflow" />
        ),
        cell: ({ row }) => {
          const organization = row.original
          return (
            <div className="flex min-w-56 flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={getHealthBadgeVariant(organization.operationalSummary.healthStatus)}>
                  {healthLabels[organization.operationalSummary.healthStatus]}
                </Badge>
                <Badge variant="outline">
                  {goLiveLabels[organization.operationalSummary.goLiveStatus]}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {onboardingLabels[organization.profile.onboardingStatus]}
                </Badge>
                <Badge variant="outline">
                  {migrationLabels[organization.profile.migrationStatus]}
                </Badge>
              </div>
            </div>
          )
        },
      },
      {
        id: 'owner',
        accessorFn: (row) => row.internalOwnerUser?.name ?? '',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Owner" />
        ),
        cell: ({ row }) => {
          const organization = row.original
          return (
            <div className="flex min-w-52 flex-col gap-1">
              <span className="font-medium">
                {organization.internalOwnerUser?.name ?? 'Sem responsável'}
              </span>
              <span className="text-sm text-muted-foreground">
                {organization.accountOwnerName ?? 'Sem owner externo'}
              </span>
            </div>
          )
        },
      },
      {
        id: 'risk',
        accessorFn: (row) =>
          row.operationalSummary.attentionScore,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Pressão" />
        ),
        cell: ({ row }) => {
          const organization = row.original
          return (
            <div className="flex min-w-48 flex-col gap-1 text-sm">
              <span>Score {organization.operationalSummary.attentionScore}</span>
              <span className="text-muted-foreground">
                {nextActionStatusLabels[organization.operationalSummary.nextActionStatus]} ·{' '}
                {organization.operationalSummary.activeBlockersCount} bloqueios
              </span>
            </div>
          )
        },
      },
    ],
    [effectiveSelectedOrganizationId],
  )

  const supportQueueData = supportQueueQuery.data?.data ?? []
  const filteredSupportQueue = useMemo(() => {
    return supportQueueData.filter((request) => {
      const isMine = request.assignedToUser?.id === session?.user?.id

      switch (ticketFilter) {
        case 'breached':
          return request.slaStatus === 'BREACHED'
        case 'due':
          return request.slaStatus === 'DUE_SOON'
        case 'open':
          return request.status === 'OPEN' || request.status === 'IN_PROGRESS'
        case 'mine':
          return isMine
        case 'waiting':
          return request.status === 'WAITING_ON_CUSTOMER'
        case 'unassigned':
          return !request.assignedToUser
        case 'escalation':
          return request.needsEscalation || Boolean(request.escalationReason)
        default:
          return true
      }
    })
  }, [session?.user?.id, supportQueueData, ticketFilter])

  const supportQueueColumns = useMemo<ColumnDef<SupportQueueItem>[]>(
    () => [
      {
        id: 'subject',
        accessorFn: (row) => row.subject,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Ticket" />
        ),
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex min-w-64 flex-col gap-1">
              <span className="font-medium">{request.subject}</span>
              <span className="text-sm text-muted-foreground">
                {request.organization?.name ?? 'Organização removida'} ·{' '}
                {requestPriorityLabels[request.priority]}
              </span>
            </div>
          )
        },
      },
      {
        id: 'sla',
        accessorFn: (row) => row.slaStatus,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SLA" />
        ),
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex min-w-44 flex-col gap-1">
              <Badge variant={getSlaBadgeVariant(request.slaStatus)}>
                {slaStatusLabels[request.slaStatus]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatRelativeSla(request.timeToSlaMs)}
              </span>
              {request.needsEscalation ? (
                <Badge variant="destructive">Escalação pendente</Badge>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'status',
        accessorFn: (row) => row.status,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex min-w-44 flex-col gap-2">
              <Badge variant="outline">{requestStatusLabels[request.status]}</Badge>
              <Badge variant={getHealthBadgeVariant(request.organizationHealth)}>
                {healthLabels[request.organizationHealth]}
              </Badge>
              {request.prioritySupport ? <Badge>Priority</Badge> : null}
            </div>
          )
        },
      },
      {
        id: 'owner',
        accessorFn: (row) => row.assignedToUser?.name ?? '',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Responsável" />
        ),
        cell: ({ row }) => (
          <div className="min-w-44 text-sm">
            <p>{row.original.assignedToUser?.name ?? 'Não atribuído'}</p>
            <p className="text-xs text-muted-foreground">
              Score {row.original.attentionScore}
            </p>
          </div>
        ),
      },
    ],
    [],
  )

  const selectedOrganization =
    organizationsQuery.data?.data.find(
      (organization) => organization.id === effectiveSelectedOrganizationId,
    ) ?? null
  const hasSelection = Boolean(
    effectiveSelectedOrganizationId && selectedOrganization,
  )
  const organizationRequests = requestsQuery.data?.data ?? []
  const profileData = profileQuery.data ?? null

  if (accessQuery.isLoading || organizationsQuery.isLoading) {
    return <InternalCustomerSuccessSkeleton />
  }

  if (accessQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backoffice</CardTitle>
          <CardDescription>
            {accessQuery.error instanceof Error
              ? accessQuery.error.message
              : 'Acesso ao backoffice negado'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (organizationsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer Success</CardTitle>
          <CardDescription>
            {organizationsQuery.error instanceof Error
              ? organizationsQuery.error.message
              : 'Falha ao carregar contas'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const totalOrganizations = organizationsQuery.data?.data.length ?? 0
  const attentionCount =
    organizationsQuery.data?.data.filter((item) => item.operationalSummary.needsAttention)
      .length ?? 0
  const priorityCount =
    organizationsQuery.data?.data.filter((item) => item.operationalSummary.prioritySupport)
      .length ?? 0
  const breachedCount =
    supportQueueData.filter((request) => request.slaStatus === 'BREACHED').length ?? 0
  const escalationCount =
    supportQueueData.filter((request) => request.needsEscalation).length ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Customer Success Operacional
        </h1>
        <p className="text-muted-foreground">
          Workspace interno para onboarding, migração, suporte prioritário e SLA.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Contas acompanhadas"
          value={String(totalOrganizations)}
          description="Organizações LAB no radar operacional"
        />
        <SummaryCard
          title="Precisam de atenção"
          value={String(attentionCount)}
          description="Contas com risco, bloqueio ou próxima ação vencida"
        />
        <SummaryCard
          title="Priority support"
          value={String(priorityCount)}
          description="Contas com postura prioritária ou dedicada"
        />
        <SummaryCard
          title="Escalação pendente"
          value={String(escalationCount)}
          description={`${breachedCount} tickets já fora do SLA alvo`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fila de Contas</CardTitle>
          <CardDescription>
            Filtre por risco ou workflow e abra a conta para operar onboarding,
            migração e suporte no mesmo contexto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'Todas'],
              ['attention', 'Precisam de atenção'],
              ['critical', 'Críticas'],
              ['priority', 'Priority support'],
              ['onboarding', 'Onboarding ativo'],
              ['migration', 'Migração ativa'],
              ['overdue', 'Próxima ação atrasada'],
              ['unassigned', 'Sem owner'],
              ['escalation', 'Escalação'],
            ].map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={organizationFilter === value ? 'default' : 'outline'}
                onClick={() =>
                  setOrganizationFilter(
                    value as
                      | 'all'
                      | 'attention'
                      | 'critical'
                      | 'priority'
                      | 'onboarding'
                      | 'migration'
                      | 'overdue'
                      | 'unassigned'
                      | 'escalation',
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por conta, slug, owner ou operador"
          />

          <DataTable
            columns={organizationColumns}
            data={filteredOrganizations}
            onRowClick={(row) => setSelectedOrganizationId(row.id)}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Conta Selecionada</CardTitle>
              <CardDescription>
                {selectedOrganization
                  ? `${selectedOrganization.name} · ${selectedOrganization.slug}`
                  : 'Selecione uma conta na fila operacional'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedOrganization ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={getHealthBadgeVariant(
                        selectedOrganization.operationalSummary.healthStatus,
                      )}
                    >
                      {
                        healthLabels[
                          selectedOrganization.operationalSummary.healthStatus
                        ]
                      }
                    </Badge>
                    <Badge variant="outline">
                      {goLiveLabels[selectedOrganization.operationalSummary.goLiveStatus]}
                    </Badge>
                    <Badge variant="outline">
                      SLA {slaTierLabels[selectedOrganization.operationalSummary.effectiveSlaTier]}
                    </Badge>
                    <Badge
                      variant={getWorkflowBadgeVariant(
                        selectedOrganization.workflow.accountOwnershipStatus,
                      )}
                    >
                      {
                        ownershipStatusLabels[
                          selectedOrganization.workflow.accountOwnershipStatus
                        ]
                      }
                    </Badge>
                    {selectedOrganization.operationalSummary.prioritySupport ? (
                      <Badge>Priority support</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={getWorkflowBadgeVariant(
                        selectedOrganization.workflow.onboardingState,
                      )}
                    >
                      Onboarding{' '}
                      {
                        workflowStateLabels[
                          selectedOrganization.workflow.onboardingState
                        ]
                      }
                    </Badge>
                    <Badge
                      variant={getWorkflowBadgeVariant(
                        selectedOrganization.workflow.migrationState,
                      )}
                    >
                      Migração{' '}
                      {
                        workflowStateLabels[
                          selectedOrganization.workflow.migrationState
                        ]
                      }
                    </Badge>
                    <Badge
                      variant={getWorkflowBadgeVariant(
                        selectedOrganization.workflow.goLiveState,
                      )}
                    >
                      Go-live{' '}
                      {workflowStateLabels[selectedOrganization.workflow.goLiveState]}
                    </Badge>
                    <Badge
                      variant={getWorkflowBadgeVariant(
                        selectedOrganization.workflow.supportState,
                      )}
                    >
                      Suporte{' '}
                      {
                        supportWorkflowStateLabels[
                          selectedOrganization.workflow.supportState
                        ]
                      }
                    </Badge>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-4">
                      <p className="text-sm font-medium">Próxima ação</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selectedOrganization.profile.nextAction ?? 'Nenhuma ação definida'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge
                          variant={getNextActionBadgeVariant(
                            selectedOrganization.operationalSummary.nextActionStatus,
                          )}
                        >
                          {
                            nextActionStatusLabels[
                              selectedOrganization.operationalSummary.nextActionStatus
                            ]
                          }
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Prazo: {formatDateTime(selectedOrganization.profile.nextActionDueAt)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-sm font-medium">Responsável interno</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selectedOrganization.internalOwnerUser?.name ?? 'Não definido'}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Último toque: {formatDateTime(selectedOrganization.profile.lastTouchedAt)}
                      </p>
                    </div>
                  </div>

                  {selectedOrganization.workflowViolations.length > 0 ? (
                    <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-4">
                      <p className="text-sm font-medium text-destructive">
                        Ações requeridas
                      </p>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {selectedOrganization.workflowViolations.map((issue) => (
                          <p key={issue.code}>{issue.message}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedOrganization.workflowWarnings.length > 0 ? (
                    <div className="rounded-lg border border-dashed p-4">
                      <p className="text-sm font-medium">Alertas do workflow</p>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {selectedOrganization.workflowWarnings.map((issue) => (
                          <p key={issue.code}>{issue.message}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-4">
                    <MiniMetric
                      label="Tickets abertos"
                      value={selectedOrganization.operationalSummary.openRequestsCount}
                    />
                    <MiniMetric
                      label="SLA vencendo"
                      value={selectedOrganization.operationalSummary.dueSoonRequestsCount}
                    />
                    <MiniMetric
                      label="SLA violado"
                      value={selectedOrganization.operationalSummary.breachedRequestsCount}
                    />
                    <MiniMetric
                      label="Escalados"
                      value={selectedOrganization.operationalSummary.escalatedRequestsCount}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedOrganization.operationalSummary.workstreams.map((item) => (
                      <Badge key={item} variant="outline">
                        {item}
                      </Badge>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => takeOwnershipMutation.mutate()}
                      disabled={takeOwnershipMutation.isPending}
                    >
                      Assumir conta
                    </Button>
                    {selectedOrganization.profile.nextAction ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          nextActionMutation.mutate({
                            markCompleted: true,
                          })
                        }
                        disabled={nextActionMutation.isPending}
                      >
                        Concluir próxima ação
                      </Button>
                    ) : null}
                  </div>

                  {selectedOrganization.operationalSummary.blockers.length > 0 ? (
                    <div className="rounded-lg border border-dashed p-4">
                      <p className="text-sm font-medium">Bloqueios ativos</p>
                      <div className="mt-3 space-y-2">
                        {selectedOrganization.operationalSummary.blockers.map((blocker) => (
                          <div
                            key={blocker.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                          >
                            <div>
                              <p className="font-medium">
                                {blockerScopeLabels[blocker.scope]}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {blocker.reason}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                blockerMutation.mutate({
                                  scope: blocker.scope,
                                  mode: 'RESOLVE',
                                })
                              }
                              disabled={blockerMutation.isPending}
                            >
                              Resolver bloqueio
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma conta selecionada.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Postura Operacional</CardTitle>
              <CardDescription>
                Atualize owner interno, saúde da conta, próximo passo e comunicação.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profileQuery.isLoading ? (
                <InternalCustomerSuccessSkeleton compact />
              ) : !hasSelection ? (
                <p className="text-sm text-muted-foreground">
                  Ajuste os filtros ou selecione uma conta na fila operacional.
                </p>
              ) : profileQuery.isError ? (
                <p className="text-sm text-destructive">
                  {profileQuery.error instanceof Error
                    ? profileQuery.error.message
                    : 'Falha ao carregar detalhe da conta'}
                </p>
              ) : (
                <form
                  className="space-y-5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    updateProfileMutation.mutate()
                  }}
                >
                  <FieldGroup>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel>Plano</FieldLabel>
                        <Input value={profileData?.plan.name ?? ''} disabled />
                      </Field>
                      <Field>
                        <FieldLabel>Modo de suporte</FieldLabel>
                        <Input
                          value={profileData?.supportPolicy.supportMode ?? ''}
                          disabled
                        />
                        <FieldDescription>
                          Meta de primeira resposta: {' '}
                          {profileData?.supportPolicy.targetFirstResponseBusinessHours ?? 0}h
                        </FieldDescription>
                      </Field>
                    </div>

                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      <p>
                        SLA efetivo:{' '}
                        <strong>
                          {profileData
                            ? slaTierLabels[profileData.policy.effectiveSlaTier]
                            : '-'}
                        </strong>
                        {' · '}
                        Resposta alvo:{' '}
                        <strong>
                          {profileData?.policy.targetFirstResponseBusinessHours ?? 0}h úteis
                        </strong>
                        {' · '}
                        Alerta SLA:{' '}
                        <strong>
                          {profileData?.policy.dueSoonThresholdBusinessHours ?? 0}h úteis
                        </strong>
                        {' · '}
                        Owner interno obrigatório:{' '}
                        <strong>
                          {profileData?.policy.requiresInternalOwnerForActiveWorkflows
                            ? 'Sim'
                            : 'Não'}
                        </strong>
                        {' · '}
                        Próxima ação obrigatória:{' '}
                        <strong>
                          {profileData?.policy.requiresNextActionForActiveWorkflows
                            ? 'Sim'
                            : 'Não'}
                        </strong>
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel>Owner da conta</FieldLabel>
                        <Input
                          value={profileDraft.accountOwnerName}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              accountOwnerName: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Email do owner</FieldLabel>
                        <Input
                          type="email"
                          value={profileDraft.accountOwnerEmail}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              accountOwnerEmail: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel>Contato de suporte</FieldLabel>
                        <Input
                          type="email"
                          value={profileDraft.supportContactEmail}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              supportContactEmail: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Owner interno</FieldLabel>
                        <NativeSelect
                          value={profileDraft.internalOwnerUserId}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              internalOwnerUserId: event.target.value,
                            }))
                          }
                        >
                          <NativeSelectOption value="">Sem owner</NativeSelectOption>
                          {(profileData?.operators ?? []).map((operator) => (
                            <NativeSelectOption key={operator.id} value={operator.id}>
                              {operator.name}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel>Onboarding</FieldLabel>
                        <NativeSelect
                          value={profileDraft.onboardingStatus}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              onboardingStatus: event.target.value as OnboardingStatus,
                            }))
                          }
                        >
                          {Object.entries(onboardingLabels).map(([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel>Migração</FieldLabel>
                        <NativeSelect
                          value={profileDraft.migrationStatus}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              migrationStatus: event.target.value as MigrationStatus,
                            }))
                          }
                        >
                          {Object.entries(migrationLabels).map(([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <Field>
                        <FieldLabel>Go-live</FieldLabel>
                        <NativeSelect
                          value={profileDraft.goLiveStatus}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              goLiveStatus: event.target.value as GoLiveStatus,
                            }))
                          }
                        >
                          {Object.entries(goLiveLabels).map(([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel>Saúde</FieldLabel>
                        <NativeSelect
                          value={profileDraft.healthStatus}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              healthStatus: event.target.value as HealthStatus,
                            }))
                          }
                        >
                          {Object.entries(healthLabels).map(([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel>SLA da conta</FieldLabel>
                        <NativeSelect
                          value={profileDraft.slaTier}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              slaTier: event.target.value as SlaTier,
                            }))
                          }
                        >
                          {Object.entries(slaTierLabels).map(([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel>Meta de go-live</FieldLabel>
                        <Input
                          type="date"
                          value={profileDraft.goLiveTargetDate}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              goLiveTargetDate: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Go-live real</FieldLabel>
                        <Input
                          type="date"
                          value={profileDraft.goLiveActualDate}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              goLiveActualDate: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                      <Field>
                        <FieldLabel>Próxima ação</FieldLabel>
                        <Input
                          value={profileDraft.nextAction}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              nextAction: event.target.value,
                            }))
                          }
                          placeholder="Ex.: validar planilha de migração e reagendar treinamento"
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Prazo</FieldLabel>
                        <Input
                          type="date"
                          value={profileDraft.nextActionDueAt}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              nextActionDueAt: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => nextActionMutation.mutate({})}
                        disabled={nextActionMutation.isPending}
                      >
                        {nextActionMutation.isPending
                          ? 'Atualizando ação...'
                          : 'Atualizar próxima ação'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          nextActionMutation.mutate({
                            markCompleted: true,
                          })
                        }
                        disabled={
                          nextActionMutation.isPending || !profileDraft.nextAction
                        }
                      >
                        Concluir ação atual
                      </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr_auto] md:items-end">
                      <Field>
                        <FieldLabel>Bloqueio</FieldLabel>
                        <NativeSelect
                          value={blockerScopeDraft}
                          onChange={(event) =>
                            setBlockerScopeDraft(event.target.value as BlockerScope)
                          }
                        >
                          {Object.entries(blockerScopeLabels).map(([value, label]) => (
                            <NativeSelectOption key={value} value={value}>
                              {label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel>Motivo do bloqueio</FieldLabel>
                        <Input
                          value={blockerReasonDraft}
                          onChange={(event) => setBlockerReasonDraft(event.target.value)}
                          placeholder="Ex.: aguardando base de migração validada"
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          blockerMutation.mutate({
                            scope: blockerScopeDraft,
                            mode: 'ADD',
                          })
                        }
                        disabled={blockerMutation.isPending || !blockerReasonDraft.trim()}
                      >
                        Registrar bloqueio
                      </Button>
                    </div>

                    <Field>
                      <FieldLabel>Priority support</FieldLabel>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={profileDraft.prioritySupport}
                          onCheckedChange={(checked) =>
                            setProfileDraft((current) => ({
                              ...current,
                              prioritySupport: checked,
                            }))
                          }
                        />
                        <FieldDescription>
                          Destaca a conta na fila e antecipa o tratamento operacional.
                        </FieldDescription>
                      </div>
                    </Field>

                    <Field>
                      <FieldLabel>Status público</FieldLabel>
                      <Textarea
                        rows={4}
                        value={profileDraft.publicStatusNote}
                        onChange={(event) =>
                          setProfileDraft((current) => ({
                            ...current,
                            publicStatusNote: event.target.value,
                          }))
                        }
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Notas internas</FieldLabel>
                      <Textarea
                        rows={5}
                        value={profileDraft.internalNotes}
                        onChange={(event) =>
                          setProfileDraft((current) => ({
                            ...current,
                            internalNotes: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </FieldGroup>

                  <Button type="submit" disabled={updateProfileMutation.isPending}>
                    {updateProfileMutation.isPending
                      ? 'Salvando...'
                      : 'Salvar postura operacional'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Timeline da Conta</CardTitle>
              <CardDescription>
                Mudanças operacionais recentes de onboarding, suporte e postura.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {profileQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))
              ) : !hasSelection ? (
                <p className="text-sm text-muted-foreground">
                  Selecione uma conta para ver a timeline operacional.
                </p>
              ) : profileQuery.data?.timeline.length ? (
                profileQuery.data.timeline.map((event) => (
                  <div key={event.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{event.action}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(event.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {event.actorUser?.name ?? 'Sistema'}
                    </p>
                    {event.details ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {JSON.stringify(event.details)}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma atividade operacional registrada para esta conta.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tickets da Conta</CardTitle>
              <CardDescription>
                Responda, atribua ou mova o status sem sair do contexto da conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {requestsQuery.isLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-40 w-full" />
                ))
              ) : !hasSelection ? (
                <p className="text-sm text-muted-foreground">
                  Selecione uma conta para operar seus tickets.
                </p>
              ) : requestsQuery.isError ? (
                <p className="text-sm text-destructive">
                  {requestsQuery.error instanceof Error
                    ? requestsQuery.error.message
                    : 'Falha ao carregar tickets'}
                </p>
              ) : organizationRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum ticket registrado para esta conta.
                </p>
              ) : (
                organizationRequests.map((request) => (
                  <div key={request.id} className="space-y-4 rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{request.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          #{request.id} · {request.category} ·{' '}
                          {requestPriorityLabels[request.priority]}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={getPriorityBadgeVariant(request.priority)}>
                          {requestPriorityLabels[request.priority]}
                        </Badge>
                        <Badge variant={getSlaBadgeVariant(request.slaStatus)}>
                          {slaStatusLabels[request.slaStatus]}
                        </Badge>
                        <Badge variant="outline">
                          {requestStatusLabels[request.status]}
                        </Badge>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {request.description}
                    </p>

                    <div className="text-xs text-muted-foreground">
                      SLA: {formatRelativeSla(request.timeToSlaMs)} · Responsável:{' '}
                      {request.assignedToUser?.name ?? 'Não atribuído'}
                    </div>

                    {request.needsEscalation || request.escalationReason ? (
                      <div className="rounded-md border border-dashed p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="destructive">
                            {request.needsEscalation
                              ? 'Escalação pendente'
                              : 'Escalado'}
                          </Badge>
                        </div>
                        <p className="mt-2 text-muted-foreground">
                          {request.escalationReason ??
                            'Este ticket precisa de acompanhamento prioritário.'}
                        </p>
                      </div>
                    ) : null}

                    <Field>
                      <FieldLabel>Resposta pública</FieldLabel>
                      <Textarea
                        rows={3}
                        value={responseDrafts[request.id] ?? ''}
                        onChange={(event) =>
                          setResponseDrafts((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        placeholder="Resposta visível para o laboratório"
                      />
                    </Field>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          assignMutation.mutate({
                            requestId: request.id,
                            assignedToUserId: session?.user?.id ?? null,
                          })
                        }
                        disabled={assignMutation.isPending}
                      >
                        Assumir
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => respondMutation.mutate(request.id)}
                        disabled={respondMutation.isPending}
                      >
                        Responder
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateStatusMutation.mutate({
                            requestId: request.id,
                            status: 'WAITING_ON_CUSTOMER',
                          })
                        }
                      >
                        Aguardar laboratório
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateStatusMutation.mutate({
                            requestId: request.id,
                            status: 'RESOLVED',
                          })
                        }
                      >
                        Resolver
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          escalateMutation.mutate({
                            requestId: request.id,
                            reason: request.slaStatus === 'BREACHED'
                              ? 'Escalação automática do operador: ticket fora do SLA.'
                              : 'Escalação manual do operador para tratamento prioritário.',
                          })
                        }
                        disabled={
                          escalateMutation.isPending ||
                          Boolean(request.escalationReason)
                        }
                      >
                        Escalar
                      </Button>
                    </div>

                    {request.events.length > 0 ? (
                      <div className="space-y-2 border-t pt-3">
                        {request.events.map((event, index) => (
                          <div
                            key={`${request.id}-${index}-${event.createdAt}`}
                            className="text-sm"
                          >
                            <p>{event.message}</p>
                            <p className="text-xs text-muted-foreground">
                              {event.actorUser?.name ?? 'Sistema'} ·{' '}
                              {formatDateTime(event.createdAt)}
                              {event.publicVisible ? ' · Público' : ' · Interno'}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fila Global de Tickets</CardTitle>
          <CardDescription>
            Visão consolidada para priorização rápida por SLA, dono e status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'Todos'],
              ['breached', 'SLA violado'],
              ['due', 'SLA vencendo'],
              ['open', 'Em tratamento'],
              ['mine', 'Meus tickets'],
              ['waiting', 'Aguardando laboratório'],
              ['unassigned', 'Sem responsável'],
              ['escalation', 'Escalação'],
            ].map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={ticketFilter === value ? 'default' : 'outline'}
                onClick={() =>
                  setTicketFilter(
                    value as
                      | 'all'
                      | 'breached'
                      | 'due'
                      | 'open'
                      | 'mine'
                      | 'waiting'
                      | 'unassigned'
                      | 'escalation',
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>

          <DataTable
            columns={supportQueueColumns}
            data={filteredSupportQueue}
            isLoading={supportQueueQuery.isLoading}
            onRowClick={(row) => {
              if (row.organization?.id) {
                setSelectedOrganizationId(row.organization.id)
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard(props: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{props.value}</p>
      </CardContent>
    </Card>
  )
}

function MiniMetric(props: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {props.label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{props.value}</p>
    </div>
  )
}

function InternalCustomerSuccessSkeleton(props?: { compact?: boolean }) {
  if (props?.compact) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-80" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-[720px] w-full" />
        <Skeleton className="h-[720px] w-full" />
      </div>
    </div>
  )
}
