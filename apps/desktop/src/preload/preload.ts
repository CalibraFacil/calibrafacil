import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  desktopBridge,
  desktopBridgeMethods,
  type CalibraBridge,
} from "@calibra-facil/contracts/desktop-bridge";

function subscribe(channel: string, listener: (value: unknown) => void) {
  const handler = (_event: IpcRendererEvent, value: unknown) => {
    listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function isBridge(value: object): value is CalibraBridge {
  return desktopBridgeMethods.every(
    (method) => typeof Reflect.get(value, method) === "function",
  );
}

/**
 * The exposed bridge, built from the table in `@calibra-facil/contracts`: one
 * member per row, `invoke` rows forwarding to their channel and `event` rows
 * subscribing to theirs. The preload holds no list of its own.
 */
function createBridge(): CalibraBridge {
  const members: Record<string, unknown> = {};

  for (const method of desktopBridgeMethods) {
    const row = desktopBridge[method];
    members[method] =
      row.kind === "invoke"
        ? async (...args: unknown[]) => ipcRenderer.invoke(row.channel, ...args)
        : (listener: (value: unknown) => void) =>
            subscribe(row.channel, listener);
  }

  if (!isBridge(members)) {
    throw new Error("The desktop bridge table did not produce a bridge.");
  }

  return members;
}

contextBridge.exposeInMainWorld("calibraBridge", createBridge());
