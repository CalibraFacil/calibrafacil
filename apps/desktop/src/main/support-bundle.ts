import { readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type {
  DesktopSettings,
  DesktopUpdateState,
  LocalEnvironmentBootstrap,
  LocalDiagnostics,
  SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import type { DesktopSecretsStore } from "./secrets-store";
import type { DesktopSettingsStore } from "./settings-store";

const SUPPORT_LOG_TAIL_BYTES = 200 * 1024;

type SupportBundleInput = {
  filePath: string;
  desktopLogFilePath: string | null;
  rendererBuildManifestPath?: string | null;
  localEnvironment: LocalEnvironmentBootstrap | null;
  localRuntime: {
    state: string;
    desktopRunId: string;
    localServerRunId: string;
    logFilePath: string;
  } | null;
  syncStatus: SyncStatusSnapshot;
  localDiagnostics: LocalDiagnostics | null;
  updateState: DesktopUpdateState;
  settingsStore: DesktopSettingsStore;
  secretsStore: DesktopSecretsStore;
};

export function defaultSupportBundlePath() {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return path.join(
    app.getPath("documents"),
    `calibra-facil-support-${timestamp}.json`,
  );
}

export async function exportSupportBundle(input: SupportBundleInput) {
  const settings = await input.settingsStore.get();
  const secretStatuses = await input.secretsStore.getStatuses();
  const desktopLog = await readSupportLogTail(input.desktopLogFilePath);
  const rendererBuild = await readSupportJson(input.rendererBuildManifestPath);
  const localServerLog = await readSupportLogTail(
    input.localRuntime?.logFilePath ?? null,
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      type: os.type(),
      cpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
    },
    desktop: {
      settings: redactSettings(settings),
      secrets: secretStatuses,
      update: input.updateState,
      rendererBuild,
      log: desktopLog,
    },
    localServer: {
      environment: redactLocalEnvironment(input.localEnvironment),
      runtime: input.localRuntime,
      log: localServerLog,
      syncStatus: input.syncStatus,
      diagnostics: input.localDiagnostics,
    },
  };

  await writeFile(input.filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
  });

  return input.filePath;
}

async function readSupportJson(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }

  try {
    return {
      path: filePath,
      data: JSON.parse(await readFile(filePath, "utf8")) as unknown,
    };
  } catch (error) {
    return {
      path: filePath,
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to read support JSON file.",
    };
  }
}

async function readSupportLogTail(filePath: string | null) {
  if (!filePath) {
    return null;
  }

  try {
    const content = await readFile(filePath, "utf8");
    return {
      path: filePath,
      truncated: Buffer.byteLength(content, "utf8") > SUPPORT_LOG_TAIL_BYTES,
      tail:
        Buffer.byteLength(content, "utf8") > SUPPORT_LOG_TAIL_BYTES
          ? content.slice(-SUPPORT_LOG_TAIL_BYTES)
          : content,
    };
  } catch (error) {
    return {
      path: filePath,
      truncated: false,
      tail: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to read local-server log.",
    };
  }
}

function redactSettings(settings: DesktopSettings): DesktopSettings {
  return settings;
}

function redactLocalEnvironment(
  localEnvironment: LocalEnvironmentBootstrap | null,
): LocalEnvironmentBootstrap | null {
  if (!localEnvironment) {
    return null;
  }

  return {
    ...localEnvironment,
    localApiToken: localEnvironment.localApiToken ? "[redacted]" : null,
  };
}
