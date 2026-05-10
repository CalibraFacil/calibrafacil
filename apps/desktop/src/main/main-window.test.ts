import { describe, expect, it, vi } from "vitest";

import { buildMainWindowOptions, hideMainWindowMenu } from "./main-window";

describe("main window configuration", () => {
  it("hides the native application menu bar", () => {
    const options = buildMainWindowOptions("/tmp/preload.cjs");

    expect(options).toMatchObject({
      autoHideMenuBar: true,
      webPreferences: {
        preload: "/tmp/preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });

  it("removes the native menu from the created window", () => {
    const window = { setMenu: vi.fn() };

    hideMainWindowMenu(window);

    expect(window.setMenu).toHaveBeenCalledWith(null);
  });
});
