import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Edit02Icon,
  RefreshIcon,
  SentIcon,
  Settings02Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  EventTimeline,
  type EventTimelineItem,
} from '@/components/event-timeline'

type WorkflowState = 'INACTIVE' | 'ACTIVE' | 'BLOCKED' | 'AT_RISK' | 'COMPLETED'
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
type SupportRequestStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
type BlockerScope = 'ONBOARDING' | 'MIGRATION' | 'GO_LIVE' | 'SUPPORT'
type SlaTier = 'PLAN_DEFAULT' | 'PRIORITY' | 'DEDICATED'

type CustomerSuccessTimelineEvent = {
  id: number
  action: string
  entityType: string
  entityId: string | null
  details: Record<string, unknown> | null
  createdAt: string
  actorUser: { id: string; name: string; email: string | null } | null
}

type ActionConfig = {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  dotClassName: string
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

const workflowStateLabels: Record<WorkflowState, string> = {
  INACTIVE: 'Inativo',
  ACTIVE: 'Ativo',
  BLOCKED: 'Bloqueado',
  AT_RISK: 'Em risco',
  COMPLETED: 'Concluído',
}

const onboardingLabels: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'Não iniciado',
  DISCOVERY: 'Discovery',
  CONFIGURATION: 'Configuração',
  TRAINING: 'Treinamento',
  LIVE: 'Em produção',
  BLOCKED: 'Bloqueado',
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

const actionConfig: Record<string, ActionConfig> = {
  'customer_success.profile.updated': {
    label: 'Perfil operacional atualizado',
    icon: Edit02Icon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'customer_success.next_action.updated': {
    label: 'Próxima ação atualizada',
    icon: Edit02Icon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'customer_success.next_action.completed': {
    label: 'Próxima ação concluída',
    icon: CheckmarkCircle02Icon,
    dotClassName: 'border-green-200 bg-green-50 text-green-700',
  },
  'customer_success.blocker.added': {
    label: 'Bloqueio registrado',
    icon: AlertCircleIcon,
    dotClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  'customer_success.blocker.resolved': {
    label: 'Bloqueio resolvido',
    icon: CheckmarkCircle02Icon,
    dotClassName: 'border-green-200 bg-green-50 text-green-700',
  },
  'customer_success.workflow.blocked': {
    label: 'Workflow bloqueado',
    icon: AlertCircleIcon,
    dotClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  'customer_success.go_live.at_risk': {
    label: 'Go-live em risco',
    icon: AlertCircleIcon,
    dotClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  'customer_success.next_action.overdue': {
    label: 'Próxima ação em atraso',
    icon: Clock01Icon,
    dotClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  'customer_success.support.sla_due_soon': {
    label: 'SLA vencendo',
    icon: Clock01Icon,
    dotClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  'customer_success.support.sla_breached': {
    label: 'SLA violado',
    icon: AlertCircleIcon,
    dotClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  'customer_success.support.escalation_required': {
    label: 'Escalação necessária',
    icon: AlertCircleIcon,
    dotClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  'customer_success.owner.required': {
    label: 'Owner interno obrigatório',
    icon: UserAdd01Icon,
    dotClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  'support_request.assigned': {
    label: 'Ticket atribuído',
    icon: UserAdd01Icon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'support_request.created': {
    label: 'Ticket criado',
    icon: UserAdd01Icon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'support_request.responded': {
    label: 'Ticket respondido',
    icon: SentIcon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'support_request.status_updated': {
    label: 'Status do ticket atualizado',
    icon: RefreshIcon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'support_request.escalated': {
    label: 'Ticket escalado',
    icon: Settings02Icon,
    dotClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  'portal_domain.created': {
    label: 'Domínio do portal criado',
    icon: Settings02Icon,
    dotClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  'portal_domain.deleted': {
    label: 'Domínio do portal removido',
    icon: Settings02Icon,
    dotClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
}

function formatUnknownValue(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (value === null || value === undefined) return ''

  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkflowState(value: unknown): value is WorkflowState {
  return typeof value === 'string' && value in workflowStateLabels
}

function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return typeof value === 'string' && value in onboardingLabels
}

function isMigrationStatus(value: unknown): value is MigrationStatus {
  return typeof value === 'string' && value in migrationLabels
}

function isGoLiveStatus(value: unknown): value is GoLiveStatus {
  return typeof value === 'string' && value in goLiveLabels
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === 'string' && value in healthLabels
}

function isSupportRequestStatus(value: unknown): value is SupportRequestStatus {
  return typeof value === 'string' && value in requestStatusLabels
}

function isBlockerScope(value: unknown): value is BlockerScope {
  return typeof value === 'string' && value in blockerScopeLabels
}

function isSlaTier(value: unknown): value is SlaTier {
  return typeof value === 'string' && value in slaTierLabels
}

function describeProfileUpdate(details: Record<string, unknown>) {
  const changes: string[] = []

  if ('internalOwnerUserId' in details) {
    changes.push(
      details.internalOwnerUserId
        ? 'owner interno definido'
        : 'owner interno removido',
    )
  }

  if (typeof details.prioritySupport === 'boolean') {
    changes.push(
      details.prioritySupport
        ? 'suporte prioritário ativado'
        : 'suporte prioritário desativado',
    )
  }

  if (isSlaTier(details.slaTier)) {
    changes.push(`SLA ${slaTierLabels[details.slaTier].toLowerCase()}`)
  }

  if (typeof details.nextAction === 'string') {
    changes.push(
      details.nextAction
        ? `próxima ação: ${details.nextAction}`
        : 'próxima ação removida',
    )
  }

  if (isOnboardingStatus(details.onboardingStatus)) {
    changes.push(`onboarding: ${onboardingLabels[details.onboardingStatus]}`)
  }

  if (isMigrationStatus(details.migrationStatus)) {
    changes.push(`migração: ${migrationLabels[details.migrationStatus]}`)
  }

  if (isGoLiveStatus(details.goLiveStatus)) {
    changes.push(`go-live: ${goLiveLabels[details.goLiveStatus]}`)
  }

  if (isHealthStatus(details.healthStatus)) {
    changes.push(`saúde da conta: ${healthLabels[details.healthStatus]}`)
  }

  return changes.length ? `Ajustes: ${changes.join(' • ')}.` : null
}

function describeTimelineEvent(event: CustomerSuccessTimelineEvent) {
  const details = event.details

  if (!isRecord(details)) {
    return null
  }

  switch (event.action) {
    case 'customer_success.profile.updated':
      return describeProfileUpdate(details)
    case 'customer_success.next_action.updated':
    case 'customer_success.next_action.completed': {
      const action =
        typeof details.nextAction === 'string' && details.nextAction
          ? details.nextAction
          : 'Sem descrição'
      const dueAt =
        typeof details.nextActionDueAt === 'string' && details.nextActionDueAt
          ? ` Prazo: ${new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(details.nextActionDueAt))}.`
          : ''

      return `${action}.${dueAt}`
    }
    case 'customer_success.blocker.added':
    case 'customer_success.blocker.resolved': {
      const scope = isBlockerScope(details.scope)
        ? blockerScopeLabels[details.scope]
        : 'Fluxo operacional'

      return typeof details.reason === 'string' && details.reason
        ? `${scope}. Motivo: ${details.reason}.`
        : `${scope}.`
    }
    case 'customer_success.workflow.blocked':
      return typeof details.blockersCount === 'number'
        ? `${details.blockersCount} bloqueio(s) ativos detectados automaticamente.`
        : 'Bloqueios ativos detectados automaticamente.'
    case 'customer_success.go_live.at_risk':
      return isWorkflowState(details.goLiveState)
        ? `Estado atual: ${workflowStateLabels[details.goLiveState]}.`
        : 'O go-live entrou em estado de risco.'
    case 'customer_success.next_action.overdue':
      return 'Existe uma próxima ação vencida no acompanhamento da conta.'
    case 'customer_success.support.sla_due_soon':
      return typeof details.dueSoonRequestsCount === 'number'
        ? `${details.dueSoonRequestsCount} ticket(s) próximos do vencimento do SLA.`
        : 'Há tickets próximos do vencimento do SLA.'
    case 'customer_success.support.sla_breached':
      return typeof details.breachedRequestsCount === 'number'
        ? `${details.breachedRequestsCount} ticket(s) fora do SLA.`
        : 'Há tickets fora do SLA.'
    case 'customer_success.support.escalation_required':
      return typeof details.escalatedRequestsCount === 'number'
        ? `${details.escalatedRequestsCount} ticket(s) exigem escalação prioritária.`
        : 'O fluxo de suporte exige escalação prioritária.'
    case 'customer_success.owner.required':
      return 'Existem fluxos ativos sem owner interno definido.'
    case 'support_request.assigned':
      return details.assignedToUserId
        ? `Ticket #${event.entityId} atribuído a um operador interno.`
        : `Ticket #${event.entityId} ficou sem responsável.`
    case 'support_request.responded':
      return details.publicVisible
        ? `Resposta pública enviada no ticket #${event.entityId}.`
        : `Resposta interna registrada no ticket #${event.entityId}.`
    case 'support_request.status_updated': {
      const previousStatus = isSupportRequestStatus(details.previousStatus)
        ? requestStatusLabels[details.previousStatus]
        : formatUnknownValue(details.previousStatus)
      const nextStatus = isSupportRequestStatus(details.nextStatus)
        ? requestStatusLabels[details.nextStatus]
        : formatUnknownValue(details.nextStatus)

      return `Ticket #${event.entityId}: ${previousStatus} -> ${nextStatus}.`
    }
    case 'support_request.escalated':
      return typeof details.reason === 'string' && details.reason
        ? `Ticket #${event.entityId} escalado: ${details.reason}.`
        : `Ticket #${event.entityId} escalado para tratamento prioritário.`
    default: {
      const parts = Object.entries(details)
        .filter(
          ([, value]) => value !== null && value !== undefined && value !== '',
        )
        .map(([key, value]) => `${key}: ${formatUnknownValue(value)}`)

      return parts.length ? parts.join(' • ') : null
    }
  }
}

function getEntityLabel(event: CustomerSuccessTimelineEvent) {
  if (event.entityType === 'organization_support_request' && event.entityId) {
    return `Ticket #${event.entityId}`
  }

  if (event.entityType === 'organization_success_profile') {
    return 'Perfil operacional'
  }

  if (event.entityType === 'portal_domain') {
    return 'Domínio do portal'
  }

  return event.entityType
}

export function CustomerSuccessAccountTimeline({
  events,
}: {
  events: CustomerSuccessTimelineEvent[]
}) {
  const items: EventTimelineItem[] = events.map((event, index) => {
    const config = actionConfig[event.action] ?? {
      label: event.action,
      icon: Clock01Icon,
      dotClassName: 'border-border bg-muted text-muted-foreground',
    }

    return {
      id: String(event.id),
      title: config.label,
      timestamp: event.createdAt,
      description: describeTimelineEvent(event),
      actor: event.actorUser?.name ?? 'Sistema',
      icon: config.icon,
      dotClassName: config.dotClassName,
      status: index === 0 ? 'active' : 'completed',
      badges: [
        { label: getEntityLabel(event), variant: 'outline' },
        ...(event.details?.automated === true
          ? [{ label: 'Automação', variant: 'secondary' as const }]
          : []),
      ],
    }
  })

  return <EventTimeline items={items} />
}
