import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
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
  /**
   * Tightens dot size, row rhythm and header layout. Use inside a narrow side
   * column, where the default (2rem dot + 2rem row padding) makes a handful of
   * events taller than the page they annotate.
   */
  compact?: boolean
  /**
   * Renders only the newest N events with a "show the rest" toggle. Omit for
   * the historical behavior of rendering everything.
   */
  initialVisibleCount?: number
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
  compact = false,
  initialVisibleCount,
}: Pick<
  EventTimelineProps,
  'items' | 'emptyMessage' | 'compact' | 'initialVisibleCount'
>) {
  const [expanded, setExpanded] = useState(false)
  const filteredItems = items.filter((item) => item.timestamp)

  if (filteredItems.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  // Events arrive newest-first, so truncating from the tail keeps the most
  // recent activity visible and folds the older history away.
  const hiddenCount =
    initialVisibleCount && !expanded
      ? Math.max(filteredItems.length - initialVisibleCount, 0)
      : 0
  const visibleItems = hiddenCount
    ? filteredItems.slice(0, initialVisibleCount)
    : filteredItems

  return (
    <div className={cn(compact && 'space-y-2')}>
      <Timeline
        className={cn(compact && 'gap-0 [--timeline-dot-size:1.75rem]')}
      >
        {visibleItems.map((item) => (
          <TimelineItem
            key={item.id}
            status={item.status ?? 'completed'}
            className={cn(compact && 'gap-2.5 pb-4')}
          >
            <TimelineDot
              className={
                item.dotClassName ??
                'border-border bg-muted text-muted-foreground'
              }
            >
              <HugeiconsIcon
                icon={item.icon}
                className={compact ? 'size-3.5' : 'size-4.5'}
              />
            </TimelineDot>
            <TimelineConnector />
            <TimelineContent className={cn(compact && 'min-w-0 pt-0.5')}>
              <TimelineHeader
                className={cn(
                  compact &&
                    'flex-row flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5',
                )}
              >
                <TimelineTitle className={cn(compact && 'text-sm')}>
                  {item.title}
                </TimelineTitle>
                {item.badges?.map((badge) => (
                  <Badge
                    key={`${item.id}-${badge.label}`}
                    variant={badge.variant ?? 'outline'}
                  >
                    {badge.label}
                  </Badge>
                ))}
                <TimelineTime
                  dateTime={item.timestamp ?? undefined}
                  className={cn(compact && 'tabular-nums')}
                >
                  {formatDateTime(item.timestamp)}
                </TimelineTime>
              </TimelineHeader>
              {item.description ? (
                <TimelineDescription className={cn(compact && 'text-xs')}>
                  {item.description}
                </TimelineDescription>
              ) : null}
              {item.actor ? (
                <p className="text-xs text-muted-foreground">{item.actor}</p>
              ) : null}
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
      {initialVisibleCount && filteredItems.length > initialVisibleCount ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center text-muted-foreground transition-transform active:scale-[0.96]"
          onClick={() => setExpanded((value) => !value)}
        >
          <HugeiconsIcon
            icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
            className="mr-1.5 size-4"
          />
          {expanded
            ? 'Mostrar menos'
            : `Mostrar mais ${hiddenCount} ${
                hiddenCount === 1 ? 'evento' : 'eventos'
              }`}
        </Button>
      ) : null}
    </div>
  )
}

export function EventTimeline({
  items,
  title = 'Histórico',
  showCard = false,
  emptyMessage,
  compact,
  initialVisibleCount,
}: EventTimelineProps) {
  const content = (
    <EventTimelineContent
      items={items}
      emptyMessage={emptyMessage}
      compact={compact}
      initialVisibleCount={initialVisibleCount}
    />
  )

  if (!showCard) {
    return content
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
