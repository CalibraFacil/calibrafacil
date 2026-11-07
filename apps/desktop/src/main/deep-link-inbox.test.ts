import { describe, expect, it, vi } from "vitest";
import { desktopBridge } from "@calibra-facil/contracts/desktop-bridge";
import { DeepLinkInbox, type DeepLinkWindow } from "./deep-link-inbox";

function fakeWindow(destroyed = false) {
  const send = vi.fn();
  const window: DeepLinkWindow = {
    isDestroyed: () => destroyed,
    webContents: { send },
  };
  return { window, send };
}

function inboxFor(window: DeepLinkWindow | null) {
  const log = { warn: vi.fn() };
  const inbox = new DeepLinkInbox({ currentWindow: () => window, log });
  return { inbox, log };
}

describe("DeepLinkInbox", () => {
  it("holds a link until the renderer says it is ready, then delivers it once", () => {
    const { window, send } = fakeWindow();
    const { inbox } = inboxFor(window);

    inbox.deliver("/dashboard/jobs");
    expect(send).not.toHaveBeenCalled();

    inbox.markRendererReady();
    expect(send).toHaveBeenCalledWith(
      desktopBridge.onDeepLink.channel,
      "/dashboard/jobs",
    );

    inbox.markRendererReady();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("delivers straight away once the renderer is listening", () => {
    const { window, send } = fakeWindow();
    const { inbox } = inboxFor(window);
    inbox.markRendererReady();

    inbox.deliver("/dashboard/assets");

    expect(send).toHaveBeenCalledWith(
      desktopBridge.onDeepLink.channel,
      "/dashboard/assets",
    );
  });

  it("buffers again after a document load tears the subscription down", () => {
    const { window, send } = fakeWindow();
    const { inbox } = inboxFor(window);
    inbox.markRendererReady();

    inbox.markRendererGone();
    inbox.deliver("/dashboard/jobs");
    expect(send).not.toHaveBeenCalled();

    inbox.markRendererReady();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest link while the renderer is away", () => {
    const { window, send } = fakeWindow();
    const { inbox } = inboxFor(window);

    inbox.deliver("/dashboard/jobs");
    inbox.deliver("/dashboard/assets");
    inbox.markRendererReady();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      desktopBridge.onDeepLink.channel,
      "/dashboard/assets",
    );
  });

  it("holds the link when there is no window or it was destroyed", () => {
    const { inbox: noWindow } = inboxFor(null);
    noWindow.markRendererReady();
    expect(() => noWindow.deliver("/dashboard/jobs")).not.toThrow();

    const { window, send } = fakeWindow(true);
    const { inbox } = inboxFor(window);
    inbox.markRendererReady();
    inbox.deliver("/dashboard/jobs");
    expect(send).not.toHaveBeenCalled();
  });

  it("validates a link from outside and logs a rejected one without delivering", () => {
    const { window, send } = fakeWindow();
    const { inbox, log } = inboxFor(window);
    inbox.markRendererReady();

    inbox.receive("https://evil.example/dashboard");
    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[desktop-deep-link] rejected",
      expect.objectContaining({ reason: expect.any(String) }),
    );

    inbox.receive("calibrafacil://open/dashboard/jobs");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
