import {
  appInfoSchema,
  certificatePdfExportRequestSchema,
  desktopAuthFetchRequestSchema,
  desktopAuthFetchResponseSchema,
  desktopSecretNameSchema,
  desktopSecretStatusSchema,
  desktopSecretWriteSchema,
  desktopSettingsPatchSchema,
  desktopSettingsSchema,
  desktopNotificationsPublishSchema,
  localPartitionActivationRequestSchema,
  localPartitionActivationResultSchema,
  desktopUpdateStateSchema,
  localEnvironmentBootstrapSchema,
  syncActionResultSchema,
  syncStateSchema,
  syncTriggerSchema,
  syncStatusSnapshotSchema,
} from "@calibra-facil/contracts";
import { desktopIpcChannels } from "./channels";

type Schema<T = unknown> = {
  parse(value: unknown): T;
};

function noArgs(): Schema<[]> {
  return {
    parse(value) {
      if (Array.isArray(value) && value.length === 0) return [];
      throw new Error("IPC channel does not accept arguments.");
    },
  };
}

function routePathResponse(): Schema<string> {
  return {
    parse(value) {
      if (typeof value === "string" && value.startsWith("/")) return value;
      throw new Error("Deep-link events carry an in-app route path.");
    },
  };
}

function nonEmptyString(): Schema<string> {
  return {
    parse(value) {
      if (typeof value === "string" && value.length > 0) return value;
      throw new Error("IPC channel expects a non-empty string.");
    },
  };
}

function booleanResponse(): Schema<boolean> {
  return {
    parse(value) {
      if (typeof value === "boolean") return value;
      throw new Error("IPC channel expects a boolean response.");
    },
  };
}

function oneArg<T>(schema: Schema<T>): Schema<[T]> {
  return {
    parse(value) {
      if (!Array.isArray(value) || value.length !== 1) {
        throw new Error("IPC channel expects exactly one argument.");
      }

      return [schema.parse(value[0])];
    },
  };
}

function arrayOf<T>(schema: Schema<T>): Schema<T[]> {
  return {
    parse(value) {
      if (!Array.isArray(value)) {
        throw new Error("Expected an array.");
      }

      return value.map((item) => schema.parse(item));
    },
  };
}

function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return {
    parse(value) {
      if (value === null) return null;
      return schema.parse(value);
    },
  };
}

const stringSchema: Schema<string> = {
  parse(value) {
    if (typeof value === "string") return value;
    throw new Error("Expected a string.");
  },
};

const nonEmptyStringSchema: Schema<string> = {
  parse(value) {
    const parsed = stringSchema.parse(value);
    if (parsed.length > 0) return parsed;
    throw new Error("Expected a non-empty string.");
  },
};

const booleanSchema: Schema<boolean> = {
  parse(value) {
    if (typeof value === "boolean") return value;
    throw new Error("Expected a boolean.");
  },
};

export const desktopIpcInvokeContracts = {
  [desktopIpcChannels.authFetch]: {
    args: oneArg(desktopAuthFetchRequestSchema),
    response: desktopAuthFetchResponseSchema,
  },
  [desktopIpcChannels.getAppInfo]: {
    args: noArgs(),
    response: appInfoSchema,
  },
  [desktopIpcChannels.getLocalEnvironmentBootstrap]: {
    args: noArgs(),
    response: nullable(localEnvironmentBootstrapSchema),
  },
  [desktopIpcChannels.getSettings]: {
    args: noArgs(),
    response: desktopSettingsSchema,
  },
  [desktopIpcChannels.setSettings]: {
    args: oneArg(desktopSettingsPatchSchema),
    response: desktopSettingsSchema,
  },
  [desktopIpcChannels.getSecretStatuses]: {
    args: noArgs(),
    response: arrayOf(desktopSecretStatusSchema),
  },
  [desktopIpcChannels.setSecret]: {
    args: oneArg(desktopSecretWriteSchema),
    response: desktopSecretStatusSchema,
  },
  [desktopIpcChannels.deleteSecret]: {
    args: oneArg(desktopSecretNameSchema),
    response: desktopSecretStatusSchema,
  },
  [desktopIpcChannels.getSyncState]: {
    args: noArgs(),
    response: syncStateSchema,
  },
  [desktopIpcChannels.getSyncStatus]: {
    args: noArgs(),
    response: syncStatusSnapshotSchema,
  },
  [desktopIpcChannels.startSync]: {
    args: noArgs(),
    response: syncActionResultSchema,
  },
  [desktopIpcChannels.pauseSync]: {
    args: noArgs(),
    response: syncActionResultSchema,
  },
  [desktopIpcChannels.resumeSync]: {
    args: noArgs(),
    response: syncActionResultSchema,
  },
  [desktopIpcChannels.wakeSync]: {
    args: oneArg(syncTriggerSchema),
    response: syncActionResultSchema,
  },
  [desktopIpcChannels.deepLinkReady]: {
    args: noArgs(),
    response: booleanResponse(),
  },
  [desktopIpcChannels.publishNotifications]: {
    args: oneArg(desktopNotificationsPublishSchema),
    response: booleanResponse(),
  },
  [desktopIpcChannels.activateLocalPartition]: {
    args: oneArg(localPartitionActivationRequestSchema),
    response: localPartitionActivationResultSchema,
  },
  [desktopIpcChannels.revealFile]: {
    args: oneArg(nonEmptyString()),
    response: booleanResponse(),
  },
  [desktopIpcChannels.retrySync]: {
    args: noArgs(),
    response: syncActionResultSchema,
  },
  [desktopIpcChannels.pickFile]: {
    args: noArgs(),
    response: nullable(stringSchema),
  },
  [desktopIpcChannels.pickFolder]: {
    args: noArgs(),
    response: nullable(stringSchema),
  },
  [desktopIpcChannels.saveFile]: {
    args: noArgs(),
    response: nullable(stringSchema),
  },
  [desktopIpcChannels.saveCertificatePdf]: {
    args: oneArg(certificatePdfExportRequestSchema),
    response: nullable(stringSchema),
  },
  [desktopIpcChannels.openExternal]: {
    args: oneArg(nonEmptyStringSchema),
    response: booleanSchema,
  },
  [desktopIpcChannels.exportSupportBundle]: {
    args: noArgs(),
    response: nullable(stringSchema),
  },
  [desktopIpcChannels.getUpdateState]: {
    args: noArgs(),
    response: desktopUpdateStateSchema,
  },
  [desktopIpcChannels.checkForUpdate]: {
    args: noArgs(),
    response: desktopUpdateStateSchema,
  },
  [desktopIpcChannels.downloadUpdate]: {
    args: noArgs(),
    response: desktopUpdateStateSchema,
  },
  [desktopIpcChannels.installUpdate]: {
    args: noArgs(),
    response: desktopUpdateStateSchema,
  },
} as const;

export const desktopIpcEventContracts = {
  [desktopIpcChannels.syncStatusChanged]: syncStatusSnapshotSchema,
  [desktopIpcChannels.updateStateChanged]: desktopUpdateStateSchema,
  // Payload is an in-app route path the main process has already validated
  // against the deep-link invariant.
  [desktopIpcChannels.deepLinkRequested]: routePathResponse(),
  // "back" or "forward", from a mouse thumb button or a trackpad swipe.
  [desktopIpcChannels.historyCommand]: nonEmptyString(),
} as const;

export type DesktopIpcInvokeChannel = keyof typeof desktopIpcInvokeContracts;
