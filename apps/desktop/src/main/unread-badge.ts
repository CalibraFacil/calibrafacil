/**
 * Unread-notification badge on the OS taskbar or dock.
 *
 * The three platforms disagree about what a badge even is, and Electron
 * exposes two unrelated APIs for it, so the *decision* is separated from the
 * *application*: `resolveUnreadBadge` is pure and tested, and the caller in
 * `main.ts` performs whichever effect it names.
 *
 * Grounded in the Electron 42 docs rather than assumed:
 *
 * - `app.setBadgeCount` is annotated **Linux and macOS only**. On Linux it
 *   needs the app's `.desktop` name to match, which is why `main.ts` calls
 *   `app.setDesktopName`; without that the badge silently does nothing.
 * - Windows has no count badge. `win.setOverlayIcon` puts a 16x16 image over
 *   the taskbar icon, which is presence, not a number.
 */

export type UnreadBadgeEffect =
  | { kind: "none" }
  | { kind: "count"; count: number }
  | { kind: "overlay"; visible: true; description: string }
  | { kind: "overlay"; visible: false };

/**
 * Windows overlays cannot carry a legible number at 16px. The count goes into
 * the overlay's accessible description instead — which is what that argument
 * is for — so screen-reader users get the figure sighted users read off the
 * in-app badge.
 */
export function describeUnreadOverlay(count: number) {
  if (count === 1) return "1 notificação não lida";

  return `${count} notificações não lidas`;
}

export function resolveUnreadBadge(
  count: number,
  platform: NodeJS.Platform,
): UnreadBadgeEffect {
  // A negative or non-finite count is a bug upstream, not a reason to render
  // something strange on the user's dock.
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  if (platform === "win32") {
    return safeCount > 0
      ? {
          kind: "overlay",
          visible: true,
          description: describeUnreadOverlay(safeCount),
        }
      : { kind: "overlay", visible: false };
  }

  if (platform === "darwin" || platform === "linux") {
    // Zero is meaningful here: Electron clears the badge on 0.
    return { kind: "count", count: safeCount };
  }

  return { kind: "none" };
}
