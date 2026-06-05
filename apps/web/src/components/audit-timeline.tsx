import {
  Clock01Icon,
  Edit02Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  SentIcon,
  UserAdd01Icon,
  AlertCircleIcon,
  PlusSignIcon,
  RefreshIcon,
  Delete02Icon,
  Archive02Icon,
  RocketIcon,
  Settings02Icon,
} from '@hugeicons/core-free-icons'

import {
  EventTimeline,
  type EventTimelineItem,
} from '@/components/event-timeline'

// Use the type of an actual icon for the icon prop
type IconComponent = typeof Clock01Icon

export interface TimelineEvent {
  id: string
  type:
    | 'created'
    | 'assigned'
    | 'executed'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'canceled'
    | 'updated'
    | 'deleted'
    | 'status_change'
    | 'renewed'
    | 'published'
    | 'archived'
    | 'new_version'
    | 'deactivate'
    | 'superseded'
    | 'amendment_created'
    | 'request_approval'
    | 'technical_review'
    | 'quality_approve'
    | 'return_to_draft'
    | 'custom'
  label: string
  timestamp: string | null
  actor?: string | null
  details?: string | null
  icon?: IconComponent
}

interface AuditTimelineProps {
  events: TimelineEvent[]
  title?: string
  showCard?: boolean
}

const eventConfig: Record<
  TimelineEvent['type'],
  { icon: IconComponent; bgColor: string; iconColor: string }
> = {
  created: {
    icon: PlusSignIcon,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  assigned: {
    icon: UserAdd01Icon,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  executed: {
    icon: Edit02Icon,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  submitted: {
    icon: SentIcon,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  approved: {
    icon: CheckmarkCircle02Icon,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  rejected: {
    icon: AlertCircleIcon,
    bgColor: 'bg-red-100',
    iconColor: 'text-red-600',
  },
  canceled: {
    icon: Cancel01Icon,
    bgColor: 'bg-gray-100',
    iconColor: 'text-gray-600',
  },
  updated: {
    icon: Edit02Icon,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  deleted: {
    icon: Delete02Icon,
    bgColor: 'bg-red-100',
    iconColor: 'text-red-600',
  },
  status_change: {
    icon: Settings02Icon,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  renewed: {
    icon: RefreshIcon,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  published: {
    icon: RocketIcon,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  archived: {
    icon: Archive02Icon,
    bgColor: 'bg-gray-100',
    iconColor: 'text-gray-600',
  },
  new_version: {
    icon: PlusSignIcon,
    bgColor: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  deactivate: {
    icon: Cancel01Icon,
    bgColor: 'bg-gray-100',
    iconColor: 'text-gray-600',
  },
  superseded: {
    icon: RefreshIcon,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  amendment_created: {
    icon: PlusSignIcon,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  request_approval: {
    icon: SentIcon,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  technical_review: {
    icon: Settings02Icon,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  quality_approve: {
    icon: CheckmarkCircle02Icon,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  return_to_draft: {
    icon: RefreshIcon,
    bgColor: 'bg-gray-100',
    iconColor: 'text-gray-600',
  },
  custom: {
    icon: Clock01Icon,
    bgColor: 'bg-muted',
    iconColor: 'text-muted-foreground',
  },
}

function mapAuditEventsToTimelineItems(
  events: TimelineEvent[],
): EventTimelineItem[] {
  return events.map((event) => {
    const config = eventConfig[event.type]

    return {
      id: event.id,
      title: event.label,
      timestamp: event.timestamp,
      description: event.details,
      actor: event.actor ? `por ${event.actor}` : null,
      icon: event.icon || config.icon,
      dotClassName: `${config.bgColor} border-transparent ${config.iconColor}`,
      status: 'completed',
    }
  })
}

export function AuditTimeline({
  events,
  title = 'Histórico',
  showCard = true,
}: AuditTimelineProps) {
  return (
    <EventTimeline
      items={mapAuditEventsToTimelineItems(events)}
      title={title}
      showCard={showCard}
    />
  )
}

/**
 * Helper to build timeline events from a job object
 */
export function buildJobTimelineEvents(job: {
  createdAt: string
  performedAt?: string | null
  approvedAt?: string | null
  rejectedAt?: string | null
  supersededAt?: string | null
  technicianName?: string | null
  approverName?: string | null
  rejectorName?: string | null
  rejectionReason?: string | null
  amendmentReason?: string | null
  supersedesId?: number | null
}): TimelineEvent[] {
  const events: TimelineEvent[] = []

  // For amendments, show that this is a correction
  if (job.supersedesId) {
    events.push({
      id: 'amendment_created',
      type: 'amendment_created',
      label: 'Retificação criada',
      timestamp: job.createdAt,
      details: job.amendmentReason,
    })
  } else {
    events.push({
      id: 'created',
      type: 'created',
      label: 'Criado',
      timestamp: job.createdAt,
    })
  }

  if (job.performedAt) {
    events.push({
      id: 'executed',
      type: 'executed',
      label: 'Executado',
      timestamp: job.performedAt,
      actor: job.technicianName,
    })
  }

  if (job.approvedAt) {
    events.push({
      id: 'approved',
      type: 'approved',
      label: 'Aprovado',
      timestamp: job.approvedAt,
      actor: job.approverName,
    })
  }

  if (job.rejectedAt) {
    events.push({
      id: 'rejected',
      type: 'rejected',
      label: 'Rejeitado',
      timestamp: job.rejectedAt,
      actor: job.rejectorName,
      details: job.rejectionReason,
    })
  }

  if (job.supersededAt) {
    events.push({
      id: 'superseded',
      type: 'superseded',
      label: 'Certificado retificado',
      timestamp: job.supersededAt,
    })
  }

  return events
}

/**
 * Action label mappings for audit logs (Portuguese)
 */
const actionLabels: Record<string, string> = {
  create: 'Criado',
  update: 'Atualizado',
  delete: 'Excluído',
  status_change: 'Status alterado',
  assign_training: 'Treinamento atribuído',
  start_training: 'Treinamento iniciado',
  complete_training: 'Treinamento concluído',
  renew: 'Certificado renovado',
  expire: 'Expirado',
  publish: 'Publicado',
  request_approval: 'Solicitou aprovação',
  technical_review: 'Revisão técnica',
  quality_approve: 'Aprovado (Qualidade)',
  return_to_draft: 'Retornou para rascunho',
  archive: 'Arquivado',
  new_version: 'Nova versão criada',
  deactivate: 'Desativado',
  suspend: 'Suspenso',
  assign: 'Atribuído',
  submit: 'Enviado para revisão',
  approve: 'Aprovado',
  reject: 'Rejeitado',
  cancel: 'Cancelado',
  execute: 'Executado',
  supersede: 'Certificado retificado',
  create_amendment: 'Retificação criada',
}

/**
 * Maps API action names to timeline event types
 */
function mapActionToEventType(action: string): TimelineEvent['type'] {
  const actionMap: Record<string, TimelineEvent['type']> = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    status_change: 'status_change',
    assign_training: 'assigned',
    start_training: 'status_change',
    complete_training: 'status_change',
    renew: 'renewed',
    expire: 'deactivate',
    publish: 'published',
    request_approval: 'request_approval',
    technical_review: 'technical_review',
    quality_approve: 'quality_approve',
    return_to_draft: 'return_to_draft',
    archive: 'archived',
    new_version: 'new_version',
    deactivate: 'deactivate',
    suspend: 'deactivate',
    assign: 'assigned',
    submit: 'submitted',
    approve: 'approved',
    reject: 'rejected',
    cancel: 'canceled',
    execute: 'executed',
    supersede: 'superseded',
    create_amendment: 'amendment_created',
  }
  return actionMap[action] || 'custom'
}

/**
 * Generic audit log record type from API
 */
export interface AuditLogRecord {
  id: number
  action: string
  changes?: Record<string, unknown> | null
  performedAt: string
  performedBy?: string | null
  performerName?: string | null
  performedByName?: string | null
  ipAddress?: string | null
  reason?: string | null
}

/**
 * Build timeline events from generic audit log records
 * Works with any entity's audit log (standards, methods, assets, services, etc.)
 */
export function buildAuditTimelineEvents(
  logs: AuditLogRecord[],
): TimelineEvent[] {
  return logs.map((log) => ({
    id: String(log.id),
    type: mapActionToEventType(log.action),
    label: actionLabels[log.action] || log.action,
    timestamp: log.performedAt,
    actor: log.performerName ?? log.performedByName ?? log.performedBy,
    details: log.reason || undefined,
  }))
}
