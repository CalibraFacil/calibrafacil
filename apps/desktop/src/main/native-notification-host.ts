import { app, nativeImage, Notification, type BrowserWindow } from "electron";
import type { DeepLinkInbox } from "./deep-link-inbox";
import type { NativeNotificationRequest } from "./native-notifications";
import { resolveUnreadBadge } from "./unread-badge";

type NativeNotificationHostDeps = {
  currentWindow(): BrowserWindow | null;
  focusWindow(): void;
  deepLinks: Pick<DeepLinkInbox, "deliver">;
  /** The Windows taskbar overlay image. */
  overlayIconPath: string;
};

/**
 * The OS side of notifications: the unread badge and the native toast. What to
 * announce is decided elsewhere (`NotificationAnnouncer`); this only performs
 * it.
 */
export class NativeNotificationHost {
  constructor(private readonly deps: NativeNotificationHostDeps) {}

  /**
   * macOS and Linux take a numeric badge; Windows only takes a 16x16 taskbar
   * overlay, which carries presence rather than a count. `resolveUnreadBadge`
   * owns that decision so it can be tested without Electron.
   */
  applyUnreadBadge(unreadCount: number) {
    const effect = resolveUnreadBadge(unreadCount, process.platform);

    if (effect.kind === "count") {
      app.setBadgeCount(effect.count);
      return;
    }

    if (effect.kind === "overlay") {
      const window = this.deps.currentWindow();
      if (!window || window.isDestroyed()) return;

      if (!effect.visible) {
        window.setOverlayIcon(null, "");
        return;
      }

      const overlay = nativeImage.createFromPath(this.deps.overlayIconPath);
      // A missing or unreadable asset must not throw inside an IPC handler.
      if (overlay.isEmpty()) return;

      window.setOverlayIcon(overlay, effect.description);
    }
  }

  present(request: NativeNotificationRequest) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: request.title,
      body: request.body,
    });

    notification.on("click", () => {
      this.deps.focusWindow();
      if (!request.actionPath) return;

      // Buffered like an OS deep link, so a click during a reload is not lost.
      // The path was already validated when the notification was built.
      this.deps.deepLinks.deliver(request.actionPath);
    });

    notification.show();
  }
}
