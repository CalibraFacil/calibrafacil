import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CheckmarkCircle02Icon,
  Notification01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { NotificationItem } from './notification-item'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import {
  useRecentNotificationsData,
  useUnreadNotificationsData,
} from '@/features/notifications/queries'
import { calibraApi } from '@/utils/api'
import { cn } from '@/lib/utils'
import { useDashboardContextState } from '@/contexts/dashboard-context'

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const organizationQueryKey = activeOrganizationId ?? 'no-org'
  const canQueryNotifications =
    Boolean(activeOrganizationId) && !isContextSwitching

  const { data: countData } = useUnreadNotificationsData({
    organizationKey: organizationQueryKey,
    enabled: canQueryNotifications,
  })

  const { data: notificationsData, isLoading } = useRecentNotificationsData({
    organizationKey: organizationQueryKey,
    enabled: canQueryNotifications && isOpen,
  })

  // Mark notification as read mutation
  const markReadMutation = useMutation({
    mutationFn: async (notificationIds: Array<number>) =>
      calibraApi.notifications.markRead(notificationIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: async () => calibraApi.notifications.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const unreadCount = countData?.count ?? 0
  const notifications = notificationsData?.data ?? []
  const hasUnread = unreadCount > 0

  const handleNotificationClick = (notificationId: number, status: string) => {
    if (status === 'UNREAD') {
      markReadMutation.mutate([notificationId])
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={(props) => (
          <Button {...props} variant="ghost" size="icon" className="relative">
            <HugeiconsIcon icon={Notification01Icon} className="h-5 w-5" />
            {hasUnread && (
              <span
                className={cn(
                  'absolute -top-1 -right-1 flex items-center justify-center',
                  'min-w-4.5 h-4.5 rounded-full bg-red-500 text-white text-xs font-medium',
                  'px-1',
                )}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <span className="sr-only">Notificações</span>
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="font-semibold text-sm">Notificações</h3>
          <div className="flex items-center gap-1">
            {hasUnread && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="h-3 w-3 mr-1"
                />
                Marcar todas
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              render={() => (
                <Link to="/dashboard/settings/notifications">
                  <HugeiconsIcon
                    icon={Settings01Icon}
                    className="h-3.5 w-3.5"
                  />
                  <span className="sr-only">Configurações</span>
                </Link>
              )}
            />
          </div>
        </div>

        <Separator />

        {/* Notification list */}
        <div className="max-h-100 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-5 w-5" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <HugeiconsIcon
                icon={Notification01Icon}
                className="h-8 w-8 text-muted-foreground/50 mb-2"
              />
              <p className="text-sm text-muted-foreground">
                Nenhuma notificação
              </p>
            </div>
          ) : (
            <div className="p-2">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={() =>
                    handleNotificationClick(
                      notification.id,
                      notification.status,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>

        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <Button
                variant="ghost"
                className="w-full h-8 text-xs"
                render={() => (
                  <Link to="/dashboard/settings/notifications">
                    Ver todas as notificações
                  </Link>
                )}
              ></Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
