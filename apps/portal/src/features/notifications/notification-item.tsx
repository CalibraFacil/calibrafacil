import { useNavigate } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { TONE } from "@/components/status-pill";
import { getNotificationTypeMeta, normalizeActionUrl } from "./lib";
import {
  useMarkNotificationsRead,
  type PortalNotificationItem,
} from "./queries";

/**
 * One feed row: tonal icon chip, title (unread = bold + dot), two-line
 * message, relative time. Clicking marks the row read and follows its deep
 * link (internal routes via the router, absolute URLs in a new tab).
 */
export function NotificationItem({
  notification,
  onNavigate,
}: {
  notification: PortalNotificationItem;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const markRead = useMarkNotificationsRead();
  const meta = getNotificationTypeMeta(notification.type);
  const isUnread = notification.status === "UNREAD";
  const target = normalizeActionUrl(notification.actionUrl);

  function handleClick() {
    if (isUnread) {
      markRead.mutate([notification.id]);
    }
    if (!target) return;
    onNavigate?.();
    if (target.kind === "external") {
      window.open(target.href, "_blank", "noopener,noreferrer");
    } else {
      void navigate({ to: target.to });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "hover:bg-muted/60 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
        isUnread && "bg-primary/4",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          TONE[meta.tone].soft,
        )}
      >
        <HugeiconsIcon icon={meta.icon} className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              isUnread ? "font-semibold" : "font-medium",
            )}
          >
            {notification.title}
          </span>
          {isUnread ? (
            <span
              className="bg-primary size-1.5 shrink-0 rounded-full"
              aria-label="Não lida"
            />
          ) : null}
        </span>
        <span className="text-muted-foreground line-clamp-2 block text-xs">
          {notification.message}
        </span>
        <span className="text-muted-foreground/80 block pt-0.5 text-[11px]">
          {formatDistanceToNow(new Date(notification.createdAt), {
            addSuffix: true,
            locale: ptBR,
          })}
        </span>
      </span>
    </button>
  );
}
