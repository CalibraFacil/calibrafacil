import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalibraBridge } from "@calibra-facil/contracts";
import {
  desktopBridge,
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

  it("routes bridge calls through the canonical IPC channels", async () => {
    mocks.invoke.mockResolvedValueOnce({ name: "CalibraFacil" });
    mocks.invoke.mockResolvedValueOnce({ autoStartSync: true });

    const { bridge } = await importPreload();

    await bridge.getAppInfo();
    await bridge.setSettings({ autoStartSync: true });

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      desktopBridge.getAppInfo.channel,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      desktopBridge.setSettings.channel,
      { autoStartSync: true },
    );

    await bridge.authFetch({
      url: "https://api.calibrafacil.com/api/auth/lab/get-session",
      method: "GET",
      headers: [],
      body: null,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      desktopBridge.authFetch.channel,
      {
        url: "https://api.calibrafacil.com/api/auth/lab/get-session",
        method: "GET",
        headers: [],
        body: null,
      },
    );

    await bridge.forgetOfflineAccess?.();
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      4,
      desktopBridge.forgetOfflineAccess.channel,
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
