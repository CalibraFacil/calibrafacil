import path from "node:path";
import type { exportSupportBundle as exportSupportBundleFile } from "../support-bundle";
import { buildSupportBundleFileName } from "../download-naming";
import { externalUrlToOpen } from "../navigation-guards";
import type { HandlersFor } from "./handler-types";

type SaveDialogResult = { canceled: boolean; filePath?: string | undefined };

type FileHandlerDeps = {
  dialog: {
    showOpenDialog(options: {
      properties: ("openFile" | "openDirectory")[];
    }): Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog(options: {
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<SaveDialogResult>;
  };
  openExternal(url: string): Promise<void>;
  /** The OS downloads folder, where a save dialog opens the first time. */
  downloadsPath(): string;
  /** Write the support bundle to `filePath` (everything the bundle gathers). */
  exportSupportBundle(
    filePath: string,
  ): ReturnType<typeof exportSupportBundleFile>;
};

/**
 * Where the next save dialog opens. Labs save certificate after certificate
 * into the same folder, so re-opening in the OS downloads directory every time
 * makes the operator navigate on every single export.
 *
 * Session-scoped on purpose: persisting it would mean restoring a path that
 * may since have been a removable drive or a disconnected share.
 */
class DownloadDirectory {
  #last: string | null = null;

  constructor(private readonly fallback: () => string) {}

  get() {
    return this.#last ?? this.fallback();
  }

  remember(filePath: string) {
    this.#last = path.dirname(filePath);
  }
}

/** Native dialogs, the system browser and the support bundle export. */
export function fileHandlers(
  deps: FileHandlerDeps,
): HandlersFor<
  | "pickFile"
  | "pickFolder"
  | "saveFile"
  | "openExternal"
  | "exportSupportBundle"
> {
  const downloads = new DownloadDirectory(deps.downloadsPath);

  return {
    pickFile: async () => {
      const result = await deps.dialog.showOpenDialog({
        properties: ["openFile"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    pickFolder: async () => {
      const result = await deps.dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    saveFile: async () => {
      const result = await deps.dialog.showSaveDialog({});
      return result.canceled ? null : (result.filePath ?? null);
    },
    openExternal: async (url) => {
      const external = externalUrlToOpen(url);
      if (!external) return false;
      await deps.openExternal(external);
      return true;
    },
    exportSupportBundle: async () => {
      const result = await deps.dialog.showSaveDialog({
        defaultPath: path.join(downloads.get(), buildSupportBundleFileName()),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;

      downloads.remember(result.filePath);

      return deps.exportSupportBundle(result.filePath);
    },
  };
}
