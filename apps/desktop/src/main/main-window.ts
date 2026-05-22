import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";

export const desktopAppName = "CalibraFácil";

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
