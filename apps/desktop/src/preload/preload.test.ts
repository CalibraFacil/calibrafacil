import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalibraBridge } from "@calibra-facil/contracts";
import {
  desktopBridge,
  desktopBridgeInvokeMethods,
  desktopBridgeMethods,
} from "@calibra-facil/contracts/desktop-bridge";

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));

async function importPreload() {
  await import("./preload");
  const call = mocks.exposeInMainWorld.mock.calls[0];
  if (!call) throw new Error("preload did not expose a bridge");
  const name: string = call[0];
  const bridge: CalibraBridge = call[1];

  return {
    name,
    bridge,
  };
}

function callBridge(
  bridge: CalibraBridge,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  const call = Reflect.get(bridge, method);
  if (typeof call !== "function") throw new Error(`${method} is missing`);
  return Reflect.apply(call, bridge, args);
}

describe("preload bridge", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("exposes only the typed Calibra bridge surface", async () => {
    const { name, bridge } = await importPreload();

    expect(name).toBe("calibraBridge");
    expect(Object.keys(bridge).sort()).toEqual(
      [...desktopBridgeMethods].sort(),
    );
  });

  it("forwards every invoke method, arguments intact, to its own channel", async () => {
    mocks.invoke.mockResolvedValue("answer");
    const { bridge } = await importPreload();

    const answers = await Promise.all(
      desktopBridgeInvokeMethods.map((method) =>
        callBridge(bridge, method, { method }, "second"),
      ),
    );

    expect(answers).toEqual(desktopBridgeInvokeMethods.map(() => "answer"));
    expect(mocks.invoke.mock.calls).toEqual(
      desktopBridgeInvokeMethods.map((method) => [
        desktopBridge[method].channel,
        { method },
        "second",
      ]),
    );
  });

  it("subscribes to typed event channels without exposing ipcRenderer", async () => {
    const listener = vi.fn();
    const { bridge } = await importPreload();

    const unsubscribe = bridge.onUpdateState(listener);
    const handler =
      typeof mocks.on.mock.calls[0]?.[1] === "function"
        ? mocks.on.mock.calls[0][1]
        : undefined;

    expect(mocks.on).toHaveBeenCalledWith(
      desktopBridge.onUpdateState.channel,
      expect.any(Function),
    );
    handler?.({}, { status: "downloaded" });
    expect(listener).toHaveBeenCalledWith({ status: "downloaded" });

    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      desktopBridge.onUpdateState.channel,
      handler,
    );
  });
});
