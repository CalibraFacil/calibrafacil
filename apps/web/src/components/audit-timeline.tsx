/**
 * Audit Timeline Component
 *
 * Displays a vertical timeline of events with icons and timestamps.
 * Used for showing job workflow history, audit logs, etc.
 */
import { HugeiconsIcon } from '@hugeicons/react'
import {
    Clock01Icon,
    Edit02Icon,
    CheckmarkCircle02Icon,
    Cancel01Icon,
    SentIcon,
    UserAdd01Icon,
    AlertCircleIcon,
} from '@hugeicons/core-free-icons'

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'

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
        icon: Clock01Icon,
        bgColor: 'bg-muted',
        iconColor: 'text-muted-foreground',
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
    custom: {
        icon: Clock01Icon,
        bgColor: 'bg-muted',
        iconColor: 'text-muted-foreground',
    },
}

function formatDateTime(dateString: string | null | undefined): string {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function TimelineContent({ events }: { events: TimelineEvent[] }) {
    const filteredEvents = events.filter((e) => e.timestamp)

    if (filteredEvents.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum evento registrado
            </p>
        )
    }

    return (
        <div className="relative space-y-4">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />

            {filteredEvents.map((event) => {
                const config = eventConfig[event.type]
                const Icon = event.icon || config.icon

                return (
                    <div key={event.id} className="flex items-start gap-3 relative">
                        <div
                            className={`h-6 w-6 rounded-full ${config.bgColor} flex items-center justify-center z-10`}
                        >
                            <HugeiconsIcon
                                icon={Icon}
                                className={`h-3 w-3 ${config.iconColor}`}
                            />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                                <p className="text-sm font-medium">{event.label}</p>
                                {event.actor && (
                                    <span className="text-xs text-muted-foreground">
                                        por {event.actor}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {formatDateTime(event.timestamp)}
                            </p>
                            {event.details && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    {event.details}
                                </p>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export function AuditTimeline({
    events,
    title = 'Histórico',
    showCard = true,
}: AuditTimelineProps) {
    if (!showCard) {
        return <TimelineContent events={events} />
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <TimelineContent events={events} />
            </CardContent>
        </Card>
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
    technicianName?: string | null
    approverName?: string | null
    rejectorName?: string | null
    rejectionReason?: string | null
}): TimelineEvent[] {
    const events: TimelineEvent[] = []

    events.push({
        id: 'created',
        type: 'created',
        label: 'Criado',
        timestamp: job.createdAt,
    })

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

    return events
}
