import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CheckmarkCircle02Icon,
  Notification01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'
import { NotificationItem } from './notification-item'
import {
  useNotificationCenterData,
  useUnreadNotificationsData,
} from './queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverTitle,
  PopoverDescription,
} from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { calibraApi } from '@/utils/api'
import { useDashboardContextState } from '@/contexts/dashboard-context'

export function NotificationCenter() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  // Remount the inbox when its scope changes, including any pending UI state.
  return (
    <ScopedNotificationCenter
      key={`${activeOrganizationId}:${isContextSwitching}`}
      organizationKey={activeOrganizationId ?? 'no-org'}
      enabled={Boolean(activeOrganizationId) && !isContextSwitching}
    />
  )
}

function ScopedNotificationCenter({
  organizationKey,
  enabled,
}: {
  organizationKey: string
  enabled: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const count = useUnreadNotificationsData({ organizationKey, enabled })
  const inbox = useNotificationCenterData({
    organizationKey,
    enabled: enabled && isOpen,
    page,
    unreadOnly: filter === 'unread',
  })
  const unreadCount = enabled ? (count.data?.count ?? 0) : 0
  const notifications = inbox.data?.data ?? []
  const pagination = inbox.data?.pagination
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['notifications', organizationKey],
    })
  const markRead = useMutation({
    mutationFn: (ids: number[]) => calibraApi.notifications.markRead(ids),
    onSuccess: async () => {
      setPage(1)
      await refresh()
    },
    onError: () =>
      toast.error(
        'Não foi possível marcar a notificação como lida. Tente novamente.',
      ),
  })
  const markAll = useMutation({
    mutationFn: () => calibraApi.notifications.markAllRead(),
    onSuccess: async () => {
      setPage(1)
      await refresh()
      toast.success('Todas as notificações foram marcadas como lidas.')
    },
    onError: () =>
      toast.error(
        'Não foi possível marcar as notificações como lidas. Tente novamente.',
      ),
  })
  const busy = markRead.isPending || markAll.isPending

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) setPage(1)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            disabled={!enabled}
            aria-label={
              unreadCount > 0
                ? `Notificações, ${unreadCount} não lidas`
                : 'Notificações'
            }
          />
        }
      >
        <HugeiconsIcon icon={Notification01Icon} aria-hidden="true" />
        {unreadCount > 0 && (
          <Badge
            aria-hidden="true"
            className="absolute -right-1 -top-1 min-w-4.5 px-1 text-[10px] tabular-nums ring-2 ring-background"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        className="flex max-h-[min(44rem,var(--available-height))] w-[min(28rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-xl p-0 shadow-xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="flex flex-col gap-1">
            <PopoverTitle className="text-lg font-semibold tracking-tight">
              Notificações
            </PopoverTitle>
            <PopoverDescription className="text-xs leading-relaxed">
              Acompanhe o que acontece no laboratório.
            </PopoverDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Preferências de notificação"
            render={
              <Link
                to="/dashboard/settings/notifications"
                onClick={() => setIsOpen(false)}
              />
            }
          >
            <HugeiconsIcon icon={Settings01Icon} aria-hidden="true" />
          </Button>
        </div>
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(String(value))
            setPage(1)
          }}
          className="min-h-0 gap-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3">
            <TabsList variant="line" aria-label="Filtrar notificações">
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="unread">
                Não lidas
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 tabular-nums">
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={!unreadCount || busy || !enabled}
              onClick={() => markAll.mutate()}
            >
              {markAll.isPending ? (
                <Spinner />
              ) : (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  aria-hidden="true"
                  data-icon="inline-start"
                />
              )}
              Marcar todas como lidas
            </Button>
          </div>
          <Separator />
          {['all', 'unread'].map((value) => (
            <TabsContent
              key={value}
              value={value}
              className="min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
            >
              {inbox.isPending ? (
                <div role="status" className="flex flex-col gap-5 p-5">
                  <span className="sr-only">Carregando notificações</span>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="size-9 shrink-0 rounded-lg" />
                      <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : inbox.isError ? (
                <div className="p-5">
                  <Alert>
                    <AlertDescription>
                      Não foi possível carregar as notificações.
                    </AlertDescription>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={inbox.isFetching}
                      onClick={() => void inbox.refetch()}
                    >
                      Tentar novamente
                    </Button>
                  </Alert>
                </div>
              ) : notifications.length === 0 ? (
                <Empty className="min-h-64 px-6 py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon
                        icon={
                          filter === 'unread'
                            ? CheckmarkCircle02Icon
                            : Notification01Icon
                        }
                        aria-hidden="true"
                      />
                    </EmptyMedia>
                    <EmptyTitle>
                      {filter === 'unread'
                        ? 'Tudo em dia'
                        : 'Nenhuma notificação por aqui'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {filter === 'unread'
                        ? 'Você já leu todas as notificações. Novas atualizações aparecerão aqui.'
                        : 'Atualizações de calibrações, certificados e prazos aparecerão aqui.'}
                    </EmptyDescription>
                  </EmptyHeader>
                  {filter === 'unread' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFilter('all')
                        setPage(1)
                      }}
                    >
                      Ver todas
                    </Button>
                  )}
                </Empty>
              ) : (
                <ul
                  className="flex flex-col gap-1 p-2"
                  aria-label="Notificações"
                >
                  <li className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Mais recentes primeiro
                  </li>
                  {notifications.map((notification) => (
                    <li key={notification.id}>
                      <NotificationItem
                        notification={notification}
                        onClick={() => {
                          if (
                            notification.status === 'UNREAD' &&
                            !busy &&
                            enabled
                          )
                            markRead.mutate([notification.id])
                          if (notification.actionUrl) setIsOpen(false)
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <Separator />
        <div className="flex shrink-0 items-center justify-between gap-3 bg-muted/30 px-5 py-3">
          <p
            role="status"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {pagination && pagination.total > 0
              ? `${(page - 1) * pagination.limit + 1}–${Math.min(page * pagination.limit, pagination.total)} de ${pagination.total}`
              : 'Sua caixa de entrada'}
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 1 || inbox.isFetching || busy}
              onClick={() => setPage((current) => current - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !pagination ||
                page >= pagination.totalPages ||
                inbox.isFetching ||
                busy
              }
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
