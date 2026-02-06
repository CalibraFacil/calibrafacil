import { Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Alert02Icon,
  Calendar03Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CreditCardValidationIcon,
  File02Icon,
  Notification01Icon,
  UserAdd02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { cn } from '@/lib/utils'

type NotificationType =
  | 'JOB_SUBMITTED_FOR_REVIEW'
  | 'JOB_APPROVED'
  | 'JOB_REJECTED'
  | 'JOB_ASSIGNED'
  | 'CERTIFICATE_READY'
  | 'CERTIFICATE_AMENDED'
  | 'ASSET_DUE_FOR_RECALIBRATION'
  | 'STANDARD_EXPIRING'
  | 'STANDARD_EXPIRED'
  | 'JOB_OVERDUE'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'NC_CREATED'
  | 'NC_ESCALATED_TO_CAPA'

type NotificationPriority = 'HIGH' | 'MEDIUM' | 'LOW'

type NotificationStatus = 'UNREAD' | 'READ' | 'ARCHIVED'

interface Notification {
  id: number
  type: NotificationType
  priority: NotificationPriority
  status: NotificationStatus
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
  PAYMENT_RECEIVED: CreditCardValidationIcon,
  PAYMENT_FAILED: CancelCircleIcon,
  NC_CREATED: Alert02Icon,
  NC_ESCALATED_TO_CAPA: Alert02Icon,
} as const

const notificationColors: Record<NotificationType, string> = {
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
  PAYMENT_RECEIVED: 'text-green-500',
  PAYMENT_FAILED: 'text-red-500',
  NC_CREATED: 'text-amber-500',
  NC_ESCALATED_TO_CAPA: 'text-red-500',
}

export function NotificationItem({
  notification,
  onClick,
}: NotificationItemProps) {
  const icon = notificationIcons[notification.type] ?? Notification01Icon
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
        'flex items-start gap-3 p-3 rounded-md transition-colors cursor-pointer',
        isUnread ? 'bg-muted/50' : 'hover:bg-muted/30',
      )}
      onClick={onClick}
    >
      <div className={cn('mt-0.5', iconColor)}>
        <HugeiconsIcon icon={icon} className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm leading-tight',
              isUnread ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {notification.message}
        </p>
        <p className="text-xs text-muted-foreground/70">{timeAgo}</p>
      </div>
    </div>
  )

  if (notification.actionUrl) {
    return (
      <Link to={notification.actionUrl} onClick={onClick}>
        {content}
      </Link>
    )
  }

  return content
}
