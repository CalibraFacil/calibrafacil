import { z } from "zod";
import {
  appInfoSchema,
  desktopAuthFetchRequestSchema,
  desktopAuthFetchResponseSchema,
  desktopNotificationsPublishSchema,
  desktopSecretNameSchema,
  desktopSecretStatusSchema,
  desktopSettingsPatchSchema,
  desktopSettingsSchema,
  desktopUpdateStateSchema,
  localEnvironmentBootstrapSchema,
  localPartitionActivationRequestSchema,
  localPartitionActivationResultSchema,
  syncActionResultSchema,
  syncStateSchema,
  syncStatusSnapshotSchema,
  syncTriggerSchema,
} from "./desktop";

/**
 * The desktop bridge, declared once.
 *
 * `window.calibraBridge` is what the Electron shell hands the web app. Each
 * method is a row here: the IPC channel it travels on and the schemas of what
 * crosses that channel. Everything else is derived from the table:
 *
 *  - the `CalibraBridge` type the web app programs against;
 *  - the preload script, which builds the exposed object from the rows;
 *  - the main process, which registers one validated handler per `invoke` row
 *    and cannot compile without a handler for each;
 *  - the tests and the smoke script, which list the surface from it.
 *
 * Adding a method is one row here plus its handler in the desktop main process
 * (the type checker names the missing one). The browser fake in
 * `apps/web/e2e` is held to the table by a test.
 */

type ArgsSchema = z.ZodType<readonly unknown[]>;

/** A request/response method: the renderer calls it, the main process answers. */
interface InvokeRow<Args extends ArgsSchema, Response extends z.ZodType> {
  readonly kind: "invoke";
  readonly channel: string;
  /** The arguments the renderer passes, validated before the handler runs. */
  readonly args: Args;
  /** What the handler returns, validated before the renderer sees it. */
  readonly response: Response;
}

/** An older desktop build does not have it: callers must tolerate absence. */
interface OptionalInvokeRow<
  Args extends ArgsSchema,
  Response extends z.ZodType,
> extends InvokeRow<Args, Response> {
  readonly optional: true;
}

/** A push from the main process: the renderer subscribes with a listener. */
interface EventRow<Payload extends z.ZodType> {
  readonly kind: "event";
  readonly channel: string;
  readonly payload: Payload;
}

interface InvokeOptions<Args extends ArgsSchema, Response extends z.ZodType> {
  channel: string;
  args: Args;
  response: Response;
}

function invoke<Args extends ArgsSchema, Response extends z.ZodType>(
  row: InvokeOptions<Args, Response>,
): InvokeRow<Args, Response> {
  return { kind: "invoke", ...row };
}

function optionalInvoke<Args extends ArgsSchema, Response extends z.ZodType>(
  row: InvokeOptions<Args, Response>,
): OptionalInvokeRow<Args, Response> {
  return { kind: "invoke", ...row, optional: true };
}

function event<Payload extends z.ZodType>(row: {
  channel: string;
  payload: Payload;
}): EventRow<Payload> {
  return { kind: "event", ...row };
}

const noArgs = z.tuple([]);
const nullableString = z.string().nullable();

export const desktopBridge = {
  authFetch: invoke({
    channel: "calibra:auth:fetch",
    args: z.tuple([desktopAuthFetchRequestSchema]),
    response: desktopAuthFetchResponseSchema,
  }),
  getAppInfo: invoke({
    channel: "calibra:app-info",
    args: noArgs,
    response: appInfoSchema,
  }),
  getLocalEnvironmentBootstrap: invoke({
    channel: "calibra:local-environment-bootstrap",
    args: noArgs,
    response: localEnvironmentBootstrapSchema.nullable(),
  }),
  getSettings: invoke({
    channel: "calibra:settings:get",
    args: noArgs,
    response: desktopSettingsSchema,
  }),
  setSettings: invoke({
    channel: "calibra:settings:set",
    args: z.tuple([desktopSettingsPatchSchema]),
    response: desktopSettingsSchema,
  }),
  getSecretStatuses: invoke({
    channel: "calibra:secrets:status",
    args: noArgs,
    response: z.array(desktopSecretStatusSchema),
  }),
  deleteSecret: invoke({
    channel: "calibra:secrets:delete",
    args: z.tuple([desktopSecretNameSchema]),
    response: desktopSecretStatusSchema,
  }),
  getSyncState: invoke({
    channel: "calibra:sync:state",
    args: noArgs,
    response: syncStateSchema,
  }),
  getSyncStatus: invoke({
    channel: "calibra:sync:status",
    args: noArgs,
    response: syncStatusSnapshotSchema,
  }),
  onSyncStatus: event({
    channel: "calibra:sync:status-changed",
    payload: syncStatusSnapshotSchema,
  }),
  startSync: invoke({
    channel: "calibra:sync:start",
    args: noArgs,
    response: syncActionResultSchema,
  }),
  pauseSync: invoke({
    channel: "calibra:sync:pause",
    args: noArgs,
    response: syncActionResultSchema,
  }),
  resumeSync: invoke({
    channel: "calibra:sync:resume",
    args: noArgs,
    response: syncActionResultSchema,
  }),
  retrySync: invoke({
    channel: "calibra:sync:retry",
    args: noArgs,
    response: syncActionResultSchema,
  }),
  /**
   * Nudge the continuous sync loop because something outside it changed —
   * the network came back, the window regained focus, the machine woke.
   * Coalesced by the scheduler, so calling it liberally is safe and calling
   * it twice is not two syncs.
   */
  wakeSync: invoke({
    channel: "calibra:sync:wake",
    args: z.tuple([syncTriggerSchema]),
    response: syncActionResultSchema,
  }),
  /**
   * Subscribe to `calibrafacil://` links the OS handed the app. The payload is
   * an in-app route path, already validated by the main process.
   */
  onDeepLink: event({
    channel: "calibra:deep-link:requested",
    payload: z
      .string()
      .refine(
        (path) => path.startsWith("/"),
        "Deep-link events carry an in-app route path.",
      ),
  }),
  /**
   * Tell the main process the renderer can receive links. A link that arrived
   * during a cold launch is buffered until this is called, so the first thing
   * a user sees after clicking a link is the linked screen — not the
   * dashboard, with the link silently dropped.
   */
  notifyDeepLinkReady: invoke({
    channel: "calibra:deep-link:ready",
    args: noArgs,
    response: z.boolean(),
  }),
  /**
   * Publish the unread count and the current feed page so the host can update
   * the taskbar badge and announce anything new. Safe to call on every poll:
   * the host de-duplicates by notification id and stays quiet while the window
   * is focused.
   */
  publishNotifications: invoke({
    channel: "calibra:notifications:publish",
    args: z.tuple([desktopNotificationsPublishSchema]),
    response: z.boolean(),
  }),
  /**
   * Back/forward gestures the OS reports to the host rather than the page:
   * mouse thumb buttons on Windows and Linux, trackpad swipe on macOS.
   * Keyboard shortcuts are handled in the renderer, where text-field focus is
   * visible. The payload is "back" or "forward".
   */
  onHistoryCommand: event({
    channel: "calibra:history:command",
    payload: z.string().min(1),
  }),
  /**
   * Ask the host to open the local database for this account and organization.
   *
   * The host decides — a caller cannot assert its way into another account's
   * data. `switched` in the result means a different database is now open and
   * the renderer must drop everything it had cached.
   */
  activateLocalPartition: invoke({
    channel: "calibra:local-partition:activate",
    args: z.tuple([localPartitionActivationRequestSchema]),
    response: localPartitionActivationResultSchema,
  }),
  /**
   * Forget the offline-access grant (sign-out): the next offline start opens no
   * account's database until someone signs in online again. The database and
   * its queued field work stay on disk for that sign-in.
   */
  forgetOfflineAccess: optionalInvoke({
    channel: "calibra:local-partition:forget",
    args: noArgs,
    response: z.boolean(),
  }),
  pickFile: invoke({
    channel: "calibra:dialog:pick-file",
    args: noArgs,
    response: nullableString,
  }),
  pickFolder: invoke({
    channel: "calibra:dialog:pick-folder",
    args: noArgs,
    response: nullableString,
  }),
  saveFile: invoke({
    channel: "calibra:dialog:save-file",
    args: noArgs,
    response: nullableString,
  }),
  openExternal: invoke({
    channel: "calibra:shell:open-external",
    args: z.tuple([z.string().min(1)]),
    response: z.boolean(),
  }),
  exportSupportBundle: invoke({
    channel: "calibra:support:export-bundle",
    args: noArgs,
    response: nullableString,
  }),
  getUpdateState: invoke({
    channel: "calibra:update:state",
    args: noArgs,
    response: desktopUpdateStateSchema,
  }),
  onUpdateState: event({
    channel: "calibra:update:state-changed",
    payload: desktopUpdateStateSchema,
  }),
  checkForUpdate: invoke({
    channel: "calibra:update:check",
    args: noArgs,
    response: desktopUpdateStateSchema,
  }),
  downloadUpdate: invoke({
    channel: "calibra:update:download",
    args: noArgs,
    response: desktopUpdateStateSchema,
  }),
  installUpdate: invoke({
    channel: "calibra:update:install",
    args: noArgs,
    response: desktopUpdateStateSchema,
  }),
};

type Bridge = typeof desktopBridge;

export type DesktopBridgeMethod = keyof Bridge;

export type DesktopBridgeInvokeMethod = {
  [K in DesktopBridgeMethod]: Bridge[K] extends { kind: "invoke" } ? K : never;
}[DesktopBridgeMethod];

export type DesktopBridgeEventMethod = Exclude<
  DesktopBridgeMethod,
  DesktopBridgeInvokeMethod
>;

type OptionalMethod = {
  [K in DesktopBridgeMethod]: Bridge[K] extends { optional: true } ? K : never;
}[DesktopBridgeMethod];

/** How the renderer calls a row. */
type BridgeMember<Row> =
  Row extends InvokeRow<infer Args, infer Response>
    ? (...args: z.output<Args>) => Promise<z.output<Response>>
    : Row extends EventRow<infer Payload>
      ? (listener: (payload: z.output<Payload>) => void) => () => void
      : never;

/** What the web app programs against: `window.calibraBridge`. */
export type CalibraBridge = {
  [K in Exclude<DesktopBridgeMethod, OptionalMethod>]: BridgeMember<Bridge[K]>;
} & {
  [K in OptionalMethod]?: BridgeMember<Bridge[K]>;
};

/**
 * What the main process implements: one function per `invoke` row, taking the
 * validated arguments. A row without a handler, or a handler without a row,
 * does not compile.
 */
export type DesktopInvokeHandlers = {
  [K in DesktopBridgeInvokeMethod]: Bridge[K] extends InvokeRow<
    infer Args,
    infer Response
  >
    ? (
        ...args: z.output<Args>
      ) => z.output<Response> | Promise<z.output<Response>>
    : never;
};

/** What the main process pushes to the renderer, per `event` row. */
export type DesktopBridgeEventPayloads = {
  [K in DesktopBridgeEventMethod]: Bridge[K] extends EventRow<infer Payload>
    ? z.output<Payload>
    : never;
};

export function isDesktopBridgeMethod(key: string): key is DesktopBridgeMethod {
  return Object.hasOwn(desktopBridge, key);
}

/** Every bridge method, `invoke` and `event`, in table order. */
export const desktopBridgeMethods: readonly DesktopBridgeMethod[] = Object.keys(
  desktopBridge,
).filter(isDesktopBridgeMethod);

export const desktopBridgeInvokeMethods: readonly DesktopBridgeInvokeMethod[] =
  desktopBridgeMethods.filter(
    (method): method is DesktopBridgeInvokeMethod =>
      desktopBridge[method].kind === "invoke",
  );

export const desktopBridgeEventMethods: readonly DesktopBridgeEventMethod[] =
  desktopBridgeMethods.filter(
    (method): method is DesktopBridgeEventMethod =>
      desktopBridge[method].kind === "event",
  );
