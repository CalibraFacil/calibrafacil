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

export function buildMainWindowOptions(
  preloadPath: string,
  iconPath?: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
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
