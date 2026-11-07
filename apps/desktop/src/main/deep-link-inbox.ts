import { desktopBridge } from "@calibra-facil/contracts/desktop-bridge";
import { describeDeepLinkRejection, resolveDeepLink } from "./deep-links";

/** The window a link is delivered to. */
export type DeepLinkWindow = {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
};

/**
 * Links on their way to the renderer.
 *
 * A link that arrives before the renderer can receive it — a cold launch, or a
 * second instance while the first is still booting — is held until the
 * renderer reports it is ready, then delivered once. The held link and the
 * readiness flag are the only state, and they change together, so they live
 * here rather than as two loose variables.
 */
export class DeepLinkInbox {
  #pendingPath: string | null = null;
  #rendererReady = false;

  constructor(
    private readonly deps: {
      currentWindow(): DeepLinkWindow | null;
      log: Pick<Console, "warn">;
    },
  ) {}

  /** Validate a link from outside the app (the OS, argv) and deliver it. */
  receive(rawUrl: string) {
    const resolved = resolveDeepLink(rawUrl);

    if (!resolved.ok) {
      // Logged, never surfaced as a dialog: an unsolicited link from a hostile
      // page must not be able to interrupt the operator with a modal.
      this.deps.log.warn("[desktop-deep-link] rejected", {
        reason: resolved.reason,
        message: describeDeepLinkRejection(resolved.reason),
      });
      return;
    }

    this.deliver(resolved.path);
  }

  /**
   * Send an already-validated route path to the renderer, or hold it until one
   * is listening.
   *
   * Separate from `receive` so internal re-delivery — flushing the buffer, a
   * notification click — does not re-run untrusted-input validation on a path
   * that already passed it. Joined, a future tightening of `resolveDeepLink`
   * could break delivery of data that never came from outside.
   */
  deliver(path: string) {
    const window = this.deps.currentWindow();
    if (!this.#rendererReady || !window || window.isDestroyed()) {
      this.#pendingPath = path;
      return;
    }

    window.webContents.send(desktopBridge.onDeepLink.channel, path);
  }

  /** The renderer subscribed: deliver what arrived while it was not listening. */
  markRendererReady() {
    this.#rendererReady = true;
    const pending = this.#pendingPath;
    this.#pendingPath = null;
    if (pending) this.deliver(pending);
  }

  /**
   * A real document load tears down the renderer's subscription; until it
   * re-announces, links must go back to the buffer rather than into a window
   * that cannot hear them.
   */
  markRendererGone() {
    this.#rendererReady = false;
  }
}
