/**
 * Which server notifications become native OS notifications.
 *
 * The renderer already polls the notification feed for the in-app centre, so
 * the desktop does not need a second source of truth — it needs a rule for
 * *which* of those the operating system should also announce, and a guarantee
 * it announces each one once.
 *
 * The rules, in order of how much they matter:
 *
 * 1. **Never announce twice.** The feed is polled, so the same notification
 *    reappears in every response. Delivery is keyed on the notification id.
 * 2. **Never announce a backlog.** The first poll after launch returns
 *    everything unread — possibly weeks of it. Firing thirty toasts at a
 *    technician opening the app is worse than firing none, so the first
 *    observation only seeds the "already seen" set.
 * 3. **Do not narrate what the user is looking at.** A focused window shows
 *    the notification in the centre already.
 */

export type NotificationFeedEntry = {
  id: number;
  title: string;
  message: string;
  status: string;
  actionUrl?: string | null;
};

export type NativeNotificationRequest = {
  id: number;
  title: string;
  body: string;
  /** In-app route to open on click, when the notification names one. */
  actionPath: string | null;
};

export type NativeNotificationDecision = {
  deliver: NativeNotificationRequest[];
  /** The id set to carry into the next observation. */
  seen: ReadonlySet<number>;
};

export type ObserveNotificationsInput = {
  entries: readonly NotificationFeedEntry[];
  /** Ids already delivered — or seeded on the first observation. */
  seen: ReadonlySet<number>;
  /** `false` before the first observation of this session. */
  primed: boolean;
  /**
   * Highest id that existed when this scope was primed. Ids are monotonic, so
   * this bounds a backlog larger than the single page the renderer sends.
   */
  highWaterMarkId?: number | null;
  /** The window currently has focus. */
  windowFocused: boolean;
  /** Cap on ids retained, so a long session cannot grow without bound. */
  maxSeen?: number;
};

const DEFAULT_MAX_SEEN = 500;

export function observeNotifications({
  entries,
  seen,
  primed,
  windowFocused,
  highWaterMarkId = null,
  maxSeen = DEFAULT_MAX_SEEN,
}: ObserveNotificationsInput): NativeNotificationDecision {
  const deliver: NativeNotificationRequest[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    // Rule 2: the first poll seeds, it does not announce.
    if (!primed) continue;
    // Anything at or below the priming high-water mark predates this session,
    // however late it surfaces. Only the first page is ever sent, so a larger
    // backlog would otherwise expose older rows later and announce them.
    if (highWaterMarkId !== null && entry.id <= highWaterMarkId) continue;
    // Rule 3: no point narrating a visible screen.
    if (windowFocused) continue;
    // Something the user already read elsewhere is not news.
    if (entry.status !== "UNREAD") continue;

    deliver.push({
      id: entry.id,
      title: entry.title,
      body: entry.message,
      actionPath: normalizeActionPath(entry.actionUrl),
    });
  }

  return {
    deliver,
    seen: trimSeen(
      entries.map((entry) => entry.id),
      seen,
      maxSeen,
    ),
  };
}

/**
 * `actionUrl` comes from the server. Only a same-app path is accepted: an
 * absolute URL here would let a notification payload navigate the desktop
 * shell somewhere it should never go.
 */
function normalizeActionPath(actionUrl: string | null | undefined) {
  if (typeof actionUrl !== "string") return null;

  const trimmed = actionUrl.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;

  return trimmed;
}

/**
 * Bounds the id set without ever forgetting something the feed is still
 * showing.
 *
 * Trimming purely by insertion age could evict an id that is still in the
 * current page, and the next poll would then announce it a second time. So
 * everything just observed is retained unconditionally, and the remaining
 * budget is filled from the previous set most-recent first.
 */
function trimSeen(
  currentIds: readonly number[],
  previous: ReadonlySet<number>,
  maxSeen: number,
): ReadonlySet<number> {
  const retained = new Set(currentIds);

  for (const id of [...previous].reverse()) {
    if (retained.size >= maxSeen) break;
    retained.add(id);
  }

  return retained;
}
