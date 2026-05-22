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

export function hideMainWindowMenu(window: MainWindowMenuTarget) {
  window.setMenu(null);
}
