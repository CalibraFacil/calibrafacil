import path from "node:path";
import { app, BrowserWindow } from "electron";
import { desktopDeepLinkScheme, findDeepLinkInArgv } from "./deep-links";
import type { DeepLinkInbox } from "./deep-link-inbox";

/**
 * Single instance. Without the lock, opening a `calibrafacil://` link while
 * the app is running starts a *second* copy — which then races the first for
 * the local server port and the SQLite file. The lock makes the running
 * instance the one that handles the link.
 */
export function installSingleInstanceDeepLinks(deps: {
  focusWindow(): void;
  deepLinks: Pick<DeepLinkInbox, "receive">;
}) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }

  app.on("second-instance", (_event, argv) => {
    deps.focusWindow();
    const link = findDeepLinkInArgv(argv);
    if (link) deps.deepLinks.receive(link);
  });

  // macOS delivers links through this event instead of argv, both cold and
  // warm. It can fire before `whenReady`, which is why the inbox buffers.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deps.focusWindow();
    deps.deepLinks.receive(url);
  });
}

export function registerDeepLinkScheme() {
  // Packaged builds get the registration from the installer (see
  // electron-builder.yml). This covers `pnpm dev:desktop`, where there is no
  // installer to do it, and is a no-op when the registration already exists.
  if (process.defaultApp) {
    const [entryScript] = process.argv.slice(1);
    if (entryScript) {
      app.setAsDefaultProtocolClient(desktopDeepLinkScheme, process.execPath, [
        path.resolve(entryScript),
      ]);
      return;
    }
  }

  app.setAsDefaultProtocolClient(desktopDeepLinkScheme);
}

/** Windows and Linux deliver a cold-launch link in argv; macOS queued it through `open-url`. */
export function deliverLaunchDeepLink(
  deepLinks: Pick<DeepLinkInbox, "receive">,
) {
  const launchLink = findDeepLinkInArgv(process.argv);
  if (launchLink) deepLinks.receive(launchLink);
}

/** Window-level app events: quitting, closing the last window, re-activation. */
export function installAppLifecycle(deps: {
  /** Release what the process holds before it exits. */
  shutdown(): void;
  /** Wait for the newest window geometry to reach disk. */
  flushWindowState(): Promise<void>;
  reopenWindow(): void;
}) {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  let windowStateFlushed = false;

  app.on("before-quit", (event) => {
    deps.shutdown();

    // The window's own `close` handler queues the final capture *after* this
    // runs, and `void flush()` would not delay shutdown anyway — so the newest
    // geometry could be lost on quit. Defer the quit once, let the close
    // captures land, then flush and quit for real.
    if (windowStateFlushed) return;

    event.preventDefault();
    void (async () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.close();
      }

      await deps.flushWindowState();
      windowStateFlushed = true;
      app.quit();
    })();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      deps.reopenWindow();
    }
  });
}
