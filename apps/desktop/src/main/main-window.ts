import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";

export const desktopAppName = "CalibraFácil";

type DesktopUserAgentVersions = {
  chrome?: string;
  electron?: string;
};

export function buildDesktopUserAgent(
  appVersion: string,
  versions: DesktopUserAgentVersions = process.versions,
) {
  return [
    "Mozilla/5.0",
    `CalibraFacilDesktop/${sanitizeUserAgentToken(appVersion)}`,
    `Chrome/${sanitizeUserAgentToken(versions.chrome ?? "0.0.0")}`,
    `Electron/${sanitizeUserAgentToken(versions.electron ?? "0.0.0")}`,
  ].join(" ");
}

export type MainWindowMenuTarget = {
  setMenu(menu: null): void;
};

/**
 * Nominal geometry. `resolveWindowState` reconciles these with what was saved
 * and with the displays actually attached, so they are the first-launch values
 * and the floor for a restore, not a guarantee.
 */
export const mainWindowSizeConstraints = {
  defaultWidth: 1280,
  defaultHeight: 860,
  minWidth: 960,
  minHeight: 640,
} as const;

export function buildMainWindowOptions(
  preloadPath: string,
  iconPath?: string,
  placement: {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    /** May be below the nominal minimum on a small display. */
    minWidth?: number;
    minHeight?: number;
  } = {},
): BrowserWindowConstructorOptions {
  return {
    width: placement.width ?? mainWindowSizeConstraints.defaultWidth,
    height: placement.height ?? mainWindowSizeConstraints.defaultHeight,
    // Omitted rather than defaulted: Electron centres a window only when x/y
    // are absent, so passing 0 would pin every first launch to the corner.
    ...(placement.x === undefined ? {} : { x: placement.x }),
    ...(placement.y === undefined ? {} : { y: placement.y }),
    // Electron enforces constructor minimums, so these must follow the
    // resolved size — otherwise a window clamped to a work area smaller than
    // the nominal minimum is pushed straight back out of view.
    minWidth: placement.minWidth ?? mainWindowSizeConstraints.minWidth,
    minHeight: placement.minHeight ?? mainWindowSizeConstraints.minHeight,
    // Restoring geometry with the window already visible produces a flash of
    // the default size in the wrong place; show it once it is positioned.
    show: false,
    title: desktopAppName,
    ...(iconPath ? { icon: iconPath } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export function desktopWindowIconPath(
  assetsDir: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") {
    return path.join(assetsDir, "icon.ico");
  }

  return path.join(assetsDir, "icon.png");
}

export function hideMainWindowMenu(window: MainWindowMenuTarget) {
  window.setMenu(null);
}

function sanitizeUserAgentToken(value: string) {
  const sanitized = value
    .replace(/[^\x21-\x7e]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "0.0.0";
}
