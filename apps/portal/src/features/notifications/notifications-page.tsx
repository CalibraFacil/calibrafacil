import { HugeiconsIcon } from "@hugeicons/react";
import { InboxIcon, Tick02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  Panel,
  StaggerGroup,
  StaggerItem,
} from "@/components/instrument-panel";
import { NotificationItem } from "./notification-item";
import {
  useMarkAllNotificationsRead,
  useNotificationFeed,
  useUnreadNotificationCount,
} from "./queries";

/**
 * Full-page view of the general notification center — the bell popover's
 * "Ver todas" target. Same feed, roomier layout, cursor-paginated.
 */
export function NotificationsPage() {
  const feed = useNotificationFeed(true);
  const countQuery = useUnreadNotificationCount();
  const markAll = useMarkAllNotificationsRead();
  const unreadCount = countQuery.data ?? 0;
  const items = feed.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="portal-shell-sm space-y-6">
      <PageHeader
        eyebrow="Portal"
        title="Notificações"
        description="Atualizações do laboratório: certificados, solicitações, visitas e qualidade dos últimos 90 dias."
        actions={
          unreadCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              Marcar todas como lidas
            </Button>
          ) : null
        }
      />

      {feed.isLoading ? (
        <Panel className="space-y-4 p-5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-start gap-3">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </Panel>
      ) : feed.isError ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-4 text-sm">
          Erro ao carregar as notificações.
        </div>
      ) : items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={InboxIcon} />
            </EmptyMedia>
            <EmptyTitle>Nenhuma notificação.</EmptyTitle>
            <EmptyDescription>
              As atualizações do laboratório — certificados liberados,
              solicitações e visitas — aparecerão aqui.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <StaggerGroup>
          <StaggerItem>
            <Panel className="p-0">
              <div className="divide-foreground/10 divide-y">
                {items.map((item) => (
                  <NotificationItem key={item.id} notification={item} />
                ))}
              </div>
              {feed.hasNextPage ? (
                <div className="border-foreground/10 border-t p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground w-full text-xs"
                    disabled={feed.isFetchingNextPage}
                    onClick={() => void feed.fetchNextPage()}
                  >
                    {feed.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
                  </Button>
                </div>
              ) : null}
            </Panel>
          </StaggerItem>
        </StaggerGroup>
      )}
    </div>
  );
}
