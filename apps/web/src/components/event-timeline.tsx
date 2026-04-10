import { HugeiconsIcon } from '@hugeicons/react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDescription,
  TimelineDot,
  TimelineHeader,
  TimelineItem,
  TimelineTime,
  TimelineTitle,
} from '@/components/ui/timeline'

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'link'

export type EventTimelineBadge = {
  label: string
  variant?: BadgeVariant
}

export type EventTimelineItem = {
  id: string
  title: string
  timestamp: string | null
  description?: string | null
  actor?: string | null
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  dotClassName?: string
  status?: 'completed' | 'active' | 'pending'
  badges?: EventTimelineBadge[]
}

type EventTimelineProps = {
  items: EventTimelineItem[]
  title?: string
  showCard?: boolean
  emptyMessage?: string
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

function EventTimelineContent({
  items,
  emptyMessage = 'Nenhum evento registrado',
}: Pick<EventTimelineProps, 'items' | 'emptyMessage'>) {
  const filteredItems = items.filter((item) => item.timestamp)

  if (filteredItems.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <Timeline>
      {filteredItems.map((item) => (
        <TimelineItem key={item.id} status={item.status ?? 'completed'}>
          <TimelineDot
            className={
              item.dotClassName ??
              'border-border bg-muted text-muted-foreground'
            }
          >
            <HugeiconsIcon icon={item.icon} className="size-4.5" />
          </TimelineDot>
          <TimelineConnector />
          <TimelineContent>
            <TimelineHeader>
              <TimelineTitle>{item.title}</TimelineTitle>
              {item.badges?.map((badge) => (
                <Badge
                  key={`${item.id}-${badge.label}`}
                  variant={badge.variant ?? 'outline'}
                >
                  {badge.label}
                </Badge>
              ))}
              <TimelineTime dateTime={item.timestamp ?? undefined}>
                {formatDateTime(item.timestamp)}
              </TimelineTime>
            </TimelineHeader>
            {item.description ? (
              <TimelineDescription>{item.description}</TimelineDescription>
            ) : null}
            {item.actor ? (
              <p className="text-xs text-muted-foreground">{item.actor}</p>
            ) : null}
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  )
}

export function EventTimeline({
  items,
  title = 'Histórico',
  showCard = false,
  emptyMessage,
}: EventTimelineProps) {
  if (!showCard) {
    return <EventTimelineContent items={items} emptyMessage={emptyMessage} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <EventTimelineContent items={items} emptyMessage={emptyMessage} />
      </CardContent>
    </Card>
  )
}
