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
  desktopUpdateStateSchema,
  localEnvironmentBootstrapSchema,
  syncActionResultSchema,
  syncStateSchema,
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
} as const;

export type DesktopIpcInvokeChannel = keyof typeof desktopIpcInvokeContracts;
