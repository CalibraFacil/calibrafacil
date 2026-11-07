import { app, BrowserWindow, dialog, screen } from "electron";
import { desktopBridge } from "@calibra-facil/contracts/desktop-bridge";
import {
  buildDesktopUserAgent,
  buildMainWindowOptions,
  desktopAppName,
  hideMainWindowMenu,
  mainWindowSizeConstraints,
} from "./main-window";
import {
  formatErrorMessage,
  installRendererDiagnostics,
} from "./renderer-diagnostics";
import { installUnloadConfirmation } from "./unload-confirmation";
import {
  resolveWindowState,
  type DesktopWindowStateStore,
  type ResolvedWindowState,
} from "./window-state";

type MainWindowHostDeps = {
  windowStateStore: Pick<DesktopWindowStateStore, "load" | "save">;
  /** The page the window loads. */
  rendererUrl: string;
  preloadPath: string;
  iconPath: string;
  /**
   * The window started loading a new document, so the renderer's subscription
   * to host events is gone until it announces itself again.
   */
  onDocumentLoadStarted(): void;
};

/**
 * The main window: creating it, restoring and saving its geometry, and the
 * gestures the OS reports to it. Holds the one reference to the window the rest
 * of the shell asks for.
 */
export class MainWindowHost {
  #window: BrowserWindow | null = null;

  constructor(private readonly deps: MainWindowHostDeps) {}

  /** The window most recently opened; it may since have been destroyed. */
  current() {
    return this.#window;
  }

  /** The window, if it exists and is still alive. */
  live() {
    const window = this.#window;
    return window && !window.isDestroyed() ? window : null;
  }

  isFocused() {
    return this.#window?.isFocused() ?? false;
  }

  focus() {
    const window = this.live();
    if (!window) return;

    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Open the window where it was last left. */
  async open() {
    this.#create(
      resolveWindowState({
        saved: await this.deps.windowStateStore.load(),
        displays: screen.getAllDisplays(),
        constraints: mainWindowSizeConstraints,
      }),
    );
  }

  #create(restored: ResolvedWindowState) {
    const desktopUserAgent = buildDesktopUserAgent(app.getVersion());
    const window = new BrowserWindow(
      buildMainWindowOptions(
        this.deps.preloadPath,
        this.deps.iconPath,
        restored,
      ),
    );
    this.#window = window;
    window.webContents.setUserAgent(desktopUserAgent);
    installRendererDiagnostics(window);
    hideMainWindowMenu(window);
    this.#installWindowStatePersistence(window, restored);
    // The calibration worksheet arms a beforeunload prompt while it holds unsaved
    // readings; without a handler Electron cancels reload/close silently.
    installUnloadConfirmation(window, () => {
      const choice = dialog.showMessageBoxSync(window, {
        type: "warning",
        title: desktopAppName,
        message: "Há leituras não salvas. Sair sem salvar?",
        detail:
          "Um rascunho local será mantido neste dispositivo e poderá ser restaurado ao reabrir a execução.",
        buttons: ["Sair sem salvar", "Continuar editando"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return choice === 0;
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(desktopAppName);
    });

    window
      .loadURL(this.deps.rendererUrl, {
        userAgent: desktopUserAgent,
      })
      .catch((error) => {
        console.error("[desktop-renderer] loadURL failed", {
          url: this.deps.rendererUrl,
          error: formatErrorMessage(error),
        });
      });
  }

  /**
   * Restore the saved window state and keep it up to date.
   *
   * Order matters: maximize/fullscreen are applied *after* the normal bounds are
   * set, so unmaximizing later returns the window to the size it had rather than
   * to the platform default. And the window is only shown once it is positioned,
   * otherwise the user watches it appear at the default size and jump.
   */
  #installWindowStatePersistence(
    window: BrowserWindow,
    restored: ResolvedWindowState,
  ) {
    if (restored.maximized) window.maximize();
    if (restored.fullScreen) window.setFullScreen(true);

    window.once("ready-to-show", () => window.show());
    installHistoryGestures(window);

    window.webContents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        // Only a real document load tears down the renderer's subscription. A
        // TanStack route or hash transition is in-place and keeps it — clearing
        // readiness there stranded every later deep link in the buffer, because
        // the still-mounted subscription never re-announces.
        if (isMainFrame && !isInPlace) this.deps.onDocumentLoadStarted();
      },
    );

    const capture = () => {
      if (window.isDestroyed()) return;

      void this.deps.windowStateStore.save({
        // `getNormalBounds` is the restore geometry: while maximized,
        // `getBounds` returns the whole screen, which would make "unmaximize" a
        // no-op on the next launch.
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized(),
        fullScreen: window.isFullScreen(),
      });
    };

    // Listed one by one: Electron's overloads type each event name separately,
    // so a loop over a union collapses to the first overload's signature.
    window.on("resized", capture);
    window.on("moved", capture);
    window.on("maximize", capture);
    window.on("unmaximize", capture);
    window.on("enter-full-screen", capture);
    window.on("leave-full-screen", capture);

    // `close`, not `closed`: the window must still be alive to be measured.
    window.on("close", capture);
  }
}

/**
 * Back/forward gestures the OS reports to the *window* rather than the page.
 *
 * Only the gestures: the keyboard shortcuts live in the renderer, because
 * deciding whether Alt+Left means "go back" or "previous word" requires
 * knowing whether a text field has focus, which the main process cannot see.
 *
 * The renderer owns the router history, so these are forwarded rather than
 * applied to `webContents` — driving both would produce two competing
 * histories.
 */
function installHistoryGestures(window: BrowserWindow) {
  const send = (command: "back" | "forward") => {
    if (window.isDestroyed()) return;
    window.webContents.send(desktopBridge.onHistoryCommand.channel, command);
  };

  // Windows: mouse thumb buttons arrive as app commands.
  window.on("app-command", (event, command) => {
    if (command === "browser-backward") {
      event.preventDefault();
      send("back");
    } else if (command === "browser-forward") {
      event.preventDefault();
      send("forward");
    }
  });

  // macOS: three-finger trackpad swipe, when the system gesture is enabled.
  // The reported direction is the physical finger movement, while the
  // platform convention is swipe *right* to go back — as in Safari and
  // Finder. Mapping them directly navigated the wrong way every time.
  window.on("swipe", (_event, direction) => {
    if (direction === "right") send("back");
    else if (direction === "left") send("forward");
  });
}
