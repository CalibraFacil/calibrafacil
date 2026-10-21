export type UnloadConfirmationTarget = {
  webContents: {
    on(
      eventName: "will-prevent-unload",
      listener: (event: { preventDefault(): void }) => void,
    ): unknown;
  };
};

/**
 * Gives the renderer's `beforeunload` prompt a native dialog.
 *
 * A browser shows its own "leave site?" prompt; Electron does not. When a page
 * vetoes an unload (the calibration worksheet does while it holds unsaved
 * readings) and nothing handles `will-prevent-unload`, the reload or window
 * close is silently cancelled and the window looks stuck. `confirmLeave` asks
 * the user; answering "leave" calls `preventDefault()`, which tells Electron to
 * ignore the page's veto and unload anyway.
 */
export function installUnloadConfirmation(
  window: UnloadConfirmationTarget,
  confirmLeave: () => boolean,
) {
  window.webContents.on("will-prevent-unload", (event) => {
    if (confirmLeave()) {
      event.preventDefault();
    }
  });
}
