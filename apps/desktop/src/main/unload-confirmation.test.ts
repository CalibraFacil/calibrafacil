import { describe, expect, it, vi } from "vitest";

import { installUnloadConfirmation } from "./unload-confirmation";

function fakeWindow() {
  let listener: ((event: { preventDefault(): void }) => void) | undefined;
  return {
    window: {
      webContents: {
        on(
          eventName: "will-prevent-unload",
          handler: (event: { preventDefault(): void }) => void,
        ) {
          expect(eventName).toBe("will-prevent-unload");
          listener = handler;
        },
      },
    },
    fire() {
      const event = { preventDefault: vi.fn() };
      listener?.(event);
      return event;
    },
  };
}

describe("installUnloadConfirmation", () => {
  // Electron cancels a reload/close silently when a page sets a beforeunload
  // prompt and nothing handles `will-prevent-unload`; the calibration worksheet
  // arms exactly that prompt while it holds unsaved readings.
  it("lets the window close or reload when the technician chooses to leave", () => {
    const { window, fire } = fakeWindow();
    installUnloadConfirmation(window, () => true);

    // preventDefault on will-prevent-unload means "ignore the page's veto".
    expect(fire().preventDefault).toHaveBeenCalledTimes(1);
  });

  it("keeps the window open when the technician chooses to stay", () => {
    const { window, fire } = fakeWindow();
    installUnloadConfirmation(window, () => false);

    expect(fire().preventDefault).not.toHaveBeenCalled();
  });
});
