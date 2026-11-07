import type { DeepLinkInbox } from "../deep-link-inbox";
import type { NativeNotificationHost } from "../native-notification-host";
import type { NotificationAnnouncer } from "../notification-announcer";
import type { HandlersFor } from "./handler-types";

/** Deep links and notifications, the two things the host pushes at the user. */
export function notificationHandlers(deps: {
  deepLinks: Pick<DeepLinkInbox, "markRendererReady">;
  announcer: Pick<NotificationAnnouncer, "observe">;
  native: Pick<NativeNotificationHost, "applyUnreadBadge" | "present">;
  isWindowFocused(): boolean;
}): HandlersFor<"notifyDeepLinkReady" | "publishNotifications"> {
  return {
    notifyDeepLinkReady: () => {
      deps.deepLinks.markRendererReady();
      return true;
    },
    publishNotifications: (published) => {
      const { unreadCount, deliver } = deps.announcer.observe(
        published,
        deps.isWindowFocused(),
      );

      deps.native.applyUnreadBadge(unreadCount);
      for (const request of deliver) {
        deps.native.present(request);
      }

      return true;
    },
  };
}
