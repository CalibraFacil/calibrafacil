import type { BrowserWindowConstructorOptions } from "electron";

export type MainWindowMenuTarget = {
  setMenu(menu: null): void;
};

export function buildMainWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "CalibraFacil",
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
