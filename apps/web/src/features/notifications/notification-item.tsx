import { Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Alert02Icon,
  Calendar03Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  File02Icon,
  Notification01Icon,
  UserAdd02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Notification {
  id: number
  type: string
  priority: string
  status: string
  title: string
  message: string
  actionUrl?: string | null
  createdAt: string
}

interface NotificationItemProps {
  notification: Notification
  onClick?: () => void
}

const notificationIcons = {
  JOB_SUBMITTED_FOR_REVIEW: File02Icon,
  JOB_APPROVED: CheckmarkCircle02Icon,
  JOB_REJECTED: CancelCircleIcon,
  JOB_ASSIGNED: UserAdd02Icon,
  CERTIFICATE_READY: File02Icon,
  CERTIFICATE_AMENDED: Alert02Icon,
  ASSET_DUE_FOR_RECALIBRATION: Calendar03Icon,
  STANDARD_EXPIRING: Alert02Icon,
  STANDARD_EXPIRED: Alert02Icon,
  JOB_OVERDUE: Alert02Icon,
  NC_CREATED: Alert02Icon,
  NC_ESCALATED_TO_CAPA: Alert02Icon,
  COMPETENCE_EXPIRING: Calendar03Icon,
  COMPETENCE_EXPIRED: Alert02Icon,
  COMPETENCE_REQUESTED: UserAdd02Icon,
  COMPETENCE_APPROVED: CheckmarkCircle02Icon,
} as const

const notificationColors: Record<string, string> = {
  JOB_SUBMITTED_FOR_REVIEW: 'text-blue-500',
  JOB_APPROVED: 'text-green-500',
  JOB_REJECTED: 'text-red-500',
  JOB_ASSIGNED: 'text-blue-500',
  CERTIFICATE_READY: 'text-green-500',
  CERTIFICATE_AMENDED: 'text-amber-500',
  ASSET_DUE_FOR_RECALIBRATION: 'text-amber-500',
  STANDARD_EXPIRING: 'text-amber-500',
  STANDARD_EXPIRED: 'text-red-500',
  JOB_OVERDUE: 'text-red-500',
  NC_CREATED: 'text-amber-500',
  NC_ESCALATED_TO_CAPA: 'text-red-500',
  COMPETENCE_EXPIRING: 'text-amber-500',
  COMPETENCE_EXPIRED: 'text-red-500',
  COMPETENCE_REQUESTED: 'text-blue-500',
  COMPETENCE_APPROVED: 'text-green-500',
}

export function NotificationItem({
  notification,
  onClick,
}: NotificationItemProps) {
  const icon =
    Object.entries(notificationIcons).find(
      ([type]) => type === notification.type,
    )?.[1] ?? Notification01Icon
  const iconColor =
    notificationColors[notification.type] ?? 'text-muted-foreground'
  const isUnread = notification.status === 'UNREAD'

  const timeAgo = formatDistanceToNow(new Date(notification.createdAt), {
    addSuffix: true,
    locale: ptBR,
  })

  const content = (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg p-4 transition-colors motion-reduce:transition-none hover:bg-muted/70',
        isUnread ? 'bg-primary/5' : 'bg-transparent',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background',
          iconColor,
        )}
      >
        <HugeiconsIcon icon={icon} className="size-4" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm leading-snug',
              isUnread ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
          )}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {notification.message}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
          <time
            dateTime={notification.createdAt}
            title={new Date(notification.createdAt).toLocaleString('pt-BR')}
          >
            {timeAgo}
          </time>
          {isUnread && (
            <span className="font-medium text-primary">Não lida</span>
          )}
          {(notification.priority === 'HIGH' ||
            notification.priority === 'URGENT') && (
            <Badge variant="outline" className="text-destructive">
              {notification.priority === 'URGENT'
                ? 'Urgente'
                : 'Alta prioridade'}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )

  if (notification.actionUrl) {
    return (
      <Link
        to={notification.actionUrl}
        onClick={onClick}
        className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
    >
      {content}
    </button>
  )
}
