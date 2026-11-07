import { describe, expect, it, vi } from "vitest";
import {
  desktopBridge,
  desktopBridgeInvokeMethods,
  type DesktopInvokeHandlers,
} from "@calibra-facil/contracts/desktop-bridge";
import {
  broadcastBridgeEvent,
  registerBridgeHandlers,
  sendBridgeEvent,
  type IpcInvokeEvent,
} from "./bridge-ipc";

type Listener = (event: IpcInvokeEvent, ...args: unknown[]) => unknown;

/** A handler table where every method answers with the same value. */
function handlersAnswering(
  answers: Partial<Record<keyof DesktopInvokeHandlers, unknown>>,
) {
  const entries = desktopBridgeInvokeMethods.map((method) => [
    method,
    vi.fn(async () => answers[method]),
  ]);
  return Object.fromEntries(entries);
}

function isHandlers(
  value: Record<string, unknown>,
): value is DesktopInvokeHandlers {
  return desktopBridgeInvokeMethods.every(
    (method) => typeof value[method] === "function",
  );
}

function register(
  handlers: Record<string, unknown>,
  assertTrustedSender: (event: IpcInvokeEvent) => void = () => {},
) {
  if (!isHandlers(handlers)) throw new Error("a mock handler is missing");

  const listeners = new Map<string, Listener>();
  const registry = {
    handle: (channel: string, listener: Listener) =>
      listeners.set(channel, listener),
  };
  registerBridgeHandlers(registry, handlers, assertTrustedSender);
  return listeners;
}

const trustedEvent: IpcInvokeEvent = {
  senderFrame: { url: "app://calibra-facil/" },
};

describe("registerBridgeHandlers", () => {
  it("registers one listener per invoke row, on that row's channel", () => {
    const listeners = register(handlersAnswering({}));

    expect([...listeners.keys()].sort()).toEqual(
      desktopBridgeInvokeMethods
        .map((method) => desktopBridge[method].channel)
        .sort(),
    );
  });

  it("checks the sender, then the arguments, then the answer", async () => {
    const answer = { ok: true };
    const handlers = handlersAnswering({ startSync: answer });
    const assertTrusted = vi.fn();
    const listeners = register(handlers, assertTrusted);
    const listener = listeners.get(desktopBridge.startSync.channel);

    await expect(listener?.(trustedEvent)).resolves.toEqual(answer);
    expect(assertTrusted).toHaveBeenCalledWith(trustedEvent);
    expect(handlers.startSync).toHaveBeenCalledWith();

    // Arguments on a no-argument channel never reach the handler.
    await expect(listener?.(trustedEvent, "extra")).rejects.toThrow();
    expect(handlers.startSync).toHaveBeenCalledTimes(1);
  });

  it("never runs a handler for an untrusted sender", async () => {
    const handlers = handlersAnswering({ getSyncState: "idle" });
    const listeners = register(handlers, () => {
      throw new Error("Blocked IPC call from untrusted sender: https://evil");
    });

    await expect(
      listeners.get(desktopBridge.getSyncState.channel)?.({
        senderFrame: { url: "https://evil" },
      }),
    ).rejects.toThrow("untrusted sender");
    expect(handlers.getSyncState).not.toHaveBeenCalled();
  });

  it("refuses an answer that does not match the row's response schema", async () => {
    const listeners = register(
      handlersAnswering({ getUpdateState: { status: "bogus" } }),
    );

    await expect(
      listeners.get(desktopBridge.getUpdateState.channel)?.(trustedEvent),
    ).rejects.toThrow();
  });
});

describe("bridge events", () => {
  it("sends a validated payload on the row's channel", () => {
    const send = vi.fn();

    sendBridgeEvent({ send }, "onUpdateState", { status: "idle" });

    expect(send).toHaveBeenCalledWith(desktopBridge.onUpdateState.channel, {
      status: "idle",
    });
  });

  it("does not send a payload the row rejects", () => {
    const send = vi.fn();

    expect(() =>
      sendBridgeEvent({ send }, "onDeepLink", "https://evil.example"),
    ).toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("broadcasts to every window", () => {
    const sends = [vi.fn(), vi.fn()];

    broadcastBridgeEvent(
      () => sends.map((send) => ({ webContents: { send } })),
      "onUpdateState",
      { status: "idle" },
    );

    for (const send of sends) expect(send).toHaveBeenCalledTimes(1);
  });
});
