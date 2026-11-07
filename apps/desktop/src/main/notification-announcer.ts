import type { DesktopNotificationsPublish } from "@calibra-facil/contracts";
import {
  observeNotifications,
  type NativeNotificationRequest,
} from "./native-notifications";

type Scope = {
  organizationKey: string;
  announcedIds: ReadonlySet<number>;
  primed: boolean;
  highWaterMarkId: number | null;
};

/**
 * Announcement state, kept **per organization**. One session-global set would
 * mean switching from A to B leaves B already primed — so B's existing unread
 * backlog is announced as new, and a slow in-flight response for A can
 * overwrite B's badge afterwards.
 *
 * Held for the session only: it is a de-duplication set, not a record worth
 * persisting, and carrying it across launches would suppress the first
 * announcement after an update.
 */
export class NotificationAnnouncer {
  #scope: Scope | null = null;

  /**
   * Account for one published feed page: which notifications to announce, and
   * the unread count for the badge.
   */
  observe(
    published: DesktopNotificationsPublish,
    windowFocused: boolean,
  ): { unreadCount: number; deliver: NativeNotificationRequest[] } {
    // A response that arrives after the user has already switched scope is
    // stale: applying its badge or announcing its rows would attribute one
    // organization's work to another.
    if (
      this.#scope &&
      this.#scope.organizationKey !== published.organizationKey
    ) {
      this.#scope = null;
    }

    const scope = this.#scope ?? {
      organizationKey: published.organizationKey,
      announcedIds: new Set<number>(),
      primed: false,
      highWaterMarkId: published.highWaterMarkId,
    };

    const decision = observeNotifications({
      entries: published.entries,
      seen: scope.announcedIds,
      primed: scope.primed,
      highWaterMarkId: scope.highWaterMarkId,
      windowFocused,
    });

    this.#scope = {
      organizationKey: published.organizationKey,
      announcedIds: decision.seen,
      primed: true,
      highWaterMarkId: scope.highWaterMarkId,
    };

    return { unreadCount: published.unreadCount, deliver: decision.deliver };
  }
}
