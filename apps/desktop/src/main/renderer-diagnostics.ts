import type { BrowserWindow } from "electron";

export function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Forward what the renderer reports about itself to the desktop log. */
export function installRendererDiagnostics(window: BrowserWindow) {
  window.webContents.on("did-fail-load", (_event, ...details) => {
    const [errorCode, errorDescription, validatedURL, isMainFrame] = details;
    console.error("[desktop-renderer] did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });

  window.webContents.on("did-finish-load", () => {
    console.log("[desktop-renderer] did-finish-load", {
      url: window.webContents.getURL(),
    });
  });

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[desktop-renderer] preload-error", {
      preloadPath,
      error: formatErrorMessage(error),
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[desktop-renderer] render-process-gone", details);
  });

  window.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (!message) return;

      const payload = {
        level,
        message,
        line,
        sourceId,
      };
      if (level >= 3) {
        console.error("[desktop-renderer] console", payload);
      } else if (level >= 2) {
        console.warn("[desktop-renderer] console", payload);
      } else {
        console.log("[desktop-renderer] console", payload);
      }
    },
  );
}
