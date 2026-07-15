import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InboxIcon,
  Notification03Icon,
  Settings01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatBadgeCount } from "./lib";
import { NotificationItem } from "./notification-item";
import {
  useMarkAllNotificationsRead,
  useNotificationFeed,
  useUnreadNotificationCount,
} from "./queries";

/**
 * Header bell for the general notification center: polled unread badge,
 * popover feed on desktop, right-hand sheet on mobile. The feed itself is
 * only fetched while open.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const countQuery = useUnreadNotificationCount();
  const count = countQuery.data ?? 0;

  const trigger = (
    <>
      <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} />
      {count > 0 ? (
        <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold tabular-nums">
          {formatBadgeCount(count)}
        </span>
      ) : null}
    </>
  );

  const panel = (
    <NotificationFeedPanel
      open={open}
      unreadCount={count}
      onNavigate={() => setOpen(false)}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Notificações"
              className="relative"
            />
          }
        >
          {trigger}
        </SheetTrigger>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">Notificações</SheetTitle>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Notificações"
            className="relative"
          />
        }
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-1rem))] gap-0 p-0"
      >
        <div className="border-foreground/10 flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-medium">Notificações</p>
          <FeedActions unreadCount={count} onNavigate={() => setOpen(false)} />
        </div>
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function FeedActions({
  unreadCount,
  onNavigate,
}: {
  unreadCount: number;
  onNavigate: () => void;
}) {
  const markAll = useMarkAllNotificationsRead();

  return (
    <div className="flex items-center gap-1">
      {unreadCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 px-2 text-xs"
          disabled={markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
          Marcar todas
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground size-7"
        aria-label="Preferências de notificação"
        render={
          <Link to="/settings" hash="notificacoes" onClick={onNavigate} />
        }
      >
        <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
      </Button>
    </div>
  );
}

function NotificationFeedPanel({
  open,
  unreadCount,
  onNavigate,
}: {
  open: boolean;
  unreadCount: number;
  onNavigate: () => void;
}) {
  const feed = useNotificationFeed(open);
  const isMobile = useIsMobile();
  const items = feed.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <>
      {isMobile ? (
        <div className="border-foreground/10 flex items-center justify-end border-b px-2 py-1.5">
          <FeedActions unreadCount={unreadCount} onNavigate={onNavigate} />
        </div>
      ) : null}
      <div className="max-h-[24rem] flex-1 overflow-y-auto">
        {feed.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : feed.isError ? (
          <p className="text-destructive p-4 text-sm">
            Erro ao carregar as notificações.
          </p>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center">
            <HugeiconsIcon icon={InboxIcon} className="size-6" />
            <p className="text-sm font-medium">Nenhuma notificação</p>
            <p className="text-xs">
              As atualizações do laboratório aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="divide-foreground/10 divide-y">
            {items.map((item) => (
              <NotificationItem
                key={item.id}
                notification={item}
                onNavigate={onNavigate}
              />
            ))}
            {feed.hasNextPage ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground w-full rounded-none text-xs"
                disabled={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="border-foreground/10 border-t p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground w-full text-xs"
          render={<Link to="/notifications" onClick={onNavigate} />}
        >
          Ver todas as notificações
        </Button>
      </div>
    </>
  );
}
