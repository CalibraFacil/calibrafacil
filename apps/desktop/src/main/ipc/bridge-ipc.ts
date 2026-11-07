import {
  desktopBridge,
  desktopBridgeInvokeMethods,
  type DesktopBridgeEventMethod,
  type DesktopBridgeEventPayloads,
  type DesktopInvokeHandlers,
} from "@calibra-facil/contracts/desktop-bridge";

/** The slice of `ipcMain` the registrar uses. */
export type InvokeRegistry = {
  handle(
    channel: string,
    listener: (event: IpcInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
};

export type IpcInvokeEvent = { senderFrame?: { url: string } | null };

/** Something that can be sent an event: a window's web contents. */
export type EventTarget = {
  send(channel: string, payload: unknown): void;
};

/**
 * Register one handler per `invoke` row of the bridge table.
 *
 * Every call goes through the same three gates, in order: the sender must be
 * the app (`assertTrustedSender` throws otherwise), the arguments must match
 * the row's schema, and the handler's answer must match the row's response
 * schema before it reaches the renderer. A handler never sees a malformed call
 * and the renderer never sees a malformed answer.
 */
export function registerBridgeHandlers(
  registry: InvokeRegistry,
  handlers: DesktopInvokeHandlers,
  assertTrustedSender: (event: IpcInvokeEvent) => void,
) {
  for (const method of desktopBridgeInvokeMethods) {
    const row = desktopBridge[method];
    const handler: (...args: never[]) => unknown = handlers[method];

    registry.handle(row.channel, async (event, ...args) => {
      assertTrustedSender(event);
      const parsedArgs = row.args.parse(args);
      return row.response.parse(
        await Reflect.apply(handler, undefined, parsedArgs),
      );
    });
  }
}

/** Send a validated event on its row's channel. */
export function sendBridgeEvent<Method extends DesktopBridgeEventMethod>(
  target: EventTarget,
  method: Method,
  payload: DesktopBridgeEventPayloads[Method],
) {
  const row = desktopBridge[method];
  target.send(row.channel, row.payload.parse(payload));
}

/** Send a validated event to every open window. */
export function broadcastBridgeEvent<Method extends DesktopBridgeEventMethod>(
  windows: () => readonly { webContents: EventTarget }[],
  method: Method,
  payload: DesktopBridgeEventPayloads[Method],
) {
  for (const window of windows()) {
    sendBridgeEvent(window.webContents, method, payload);
  }
}
