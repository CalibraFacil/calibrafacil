import { isTrustedUrl, type TrustedOrigins } from "./trusted-origins";

/**
 * Keeps every web contents on the app.
 *
 * The window that runs the UI owns the IPC bridge, so a navigation to any
 * other page (a link without `target`, a redirect, `location.href = ...`)
 * would put that page one `ipcRenderer.invoke` away from `authFetch` and the
 * local API token. The IPC sender check is the backstop; this is the fence:
 * anything that is not the app is cancelled, and a web link is handed to the
 * system browser instead.
 */

/**
 * The URL to hand to the system browser, or null when it must not be opened.
 * Only `http(s)` links without embedded credentials qualify: `shell.openExternal`
 * will launch whatever handler the OS has for any other scheme.
 */
export function externalUrlToOpen(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;

  return url.toString();
}

export type NavigationDecision =
  | { action: "allow" }
  | { action: "block"; openExternally: string | null };

export function decideNavigation(
  rawUrl: unknown,
  trusted: TrustedOrigins,
): NavigationDecision {
  if (isTrustedUrl(rawUrl, trusted)) return { action: "allow" };

  return { action: "block", openExternally: externalUrlToOpen(rawUrl) };
}

type NavigationEvent = {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
};

type NavigationListener = (event: NavigationEvent) => void;

/** The slice of Electron's `WebContents` the guards use. */
export type GuardedWebContents = {
  on(eventName: "will-navigate", listener: NavigationListener): unknown;
  on(eventName: "will-redirect", listener: NavigationListener): unknown;
  on(eventName: "will-frame-navigate", listener: NavigationListener): unknown;
  on(
    eventName: "will-attach-webview",
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
};

export type NavigationGuardOptions = {
  /** Read on every event, so a changed environment is picked up. */
  trustedOrigins: () => TrustedOrigins;
  openExternal: (url: string) => void;
  now?: () => number;
};

/** `will-navigate` and `will-frame-navigate` both report one navigation. */
const duplicateOpenWindowMs = 1000;

export function installNavigationGuards(
  contents: GuardedWebContents,
  options: NavigationGuardOptions,
) {
  const now = options.now ?? Date.now;
  let lastOpened: { url: string; at: number } | null = null;

  const openExternally = (url: string) => {
    const at = now();
    if (
      lastOpened &&
      lastOpened.url === url &&
      at - lastOpened.at < duplicateOpenWindowMs
    ) {
      return;
    }

    lastOpened = { url, at };
    options.openExternal(url);
  };

  // Subframes are not fenced here: the Content-Security-Policy's `frame-src`
  // decides what a frame may load (the certificate preview is a signed
  // storage URL), and blocking a frame's own internal navigations would break
  // Chromium's PDF viewer.
  const guard: NavigationListener = (event) => {
    if (!event.isMainFrame) return;

    const decision = decideNavigation(event.url, options.trustedOrigins());
    if (decision.action === "allow") return;

    event.preventDefault();
    if (decision.openExternally) openExternally(decision.openExternally);
  };

  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-frame-navigate", guard);

  // The app never embeds a <webview>; refuse one rather than configure it.
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  // No new windows, ever: a link that asks for one goes to the browser.
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalUrlToOpen(url);
    if (external) openExternally(external);

    return { action: "deny" };
  });
}
