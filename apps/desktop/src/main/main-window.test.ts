import { describe, expect, it, vi } from "vitest";

import {
  buildMainWindowOptions,
  desktopWindowIconPath,
  hideMainWindowMenu,
} from "./main-window";

describe("main window configuration", () => {
  it("hides the native application menu bar", () => {
    const options = buildMainWindowOptions("/tmp/preload.cjs");

    expect(options).toMatchObject({
      title: "CalibraFácil",
      autoHideMenuBar: true,
      webPreferences: {
        preload: "/tmp/preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });

  it("uses the branded desktop icon when provided", () => {
    const options = buildMainWindowOptions(
      "/tmp/preload.cjs",
      "/tmp/calibra-icon.png",
    );

    expect(options.icon).toBe("/tmp/calibra-icon.png");
  });

  it("uses the multi-size ico for the Windows title bar icon", () => {
    expect(desktopWindowIconPath("/tmp/assets", "win32")).toBe(
      "/tmp/assets/icon.ico",
    );
  });

  it("uses the png window icon outside Windows", () => {
    expect(desktopWindowIconPath("/tmp/assets", "linux")).toBe(
      "/tmp/assets/icon.png",
    );
  });

  it("removes the native menu from the created window", () => {
    const window = { setMenu: vi.fn() };

    hideMainWindowMenu(window);

    expect(window.setMenu).toHaveBeenCalledWith(null);
  });
});
