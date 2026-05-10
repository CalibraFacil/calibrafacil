import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  desktopSettingsPatchSchema,
  desktopSettingsSchema,
  type DesktopSettings,
} from "@calibra-facil/contracts";

const settingsDirectory = "settings";
const settingsFileName = "desktop-settings.json";

const defaultSettings = desktopSettingsSchema.parse({
  autoStartSync: true,
  updateChannel: "stable",
});

export class DesktopSettingsStore {
  private current = defaultSettings;
  private loaded = false;
  private readonly filePath: string;

  constructor(private readonly userDataPath: string) {
    this.filePath = path.join(
      userDataPath,
      settingsDirectory,
      settingsFileName,
    );
  }

  async load(): Promise<DesktopSettings> {
    if (this.loaded) return this.current;

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.current = readDesktopSettings(JSON.parse(raw));
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.current = defaultSettings;
        await this.persist();
      }
    }

    this.loaded = true;
    return this.current;
  }

  async get(): Promise<DesktopSettings> {
    return this.load();
  }

  async update(patch: unknown): Promise<DesktopSettings> {
    const current = await this.load();
    this.current = desktopSettingsSchema.parse({
      ...current,
      ...desktopSettingsPatchSchema.parse(patch),
    });
    await this.persist();
    return this.current;
  }

  private async persist() {
    const directory = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(this.current, null, 2)}\n`;

    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function readDesktopSettings(value: unknown): DesktopSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultSettings;
  }

  const candidate = value as Record<string, unknown>;
  return desktopSettingsSchema.parse({
    autoStartSync:
      typeof candidate.autoStartSync === "boolean"
        ? candidate.autoStartSync
        : defaultSettings.autoStartSync,
    updateChannel:
      candidate.updateChannel === "stable" || candidate.updateChannel === "beta"
        ? candidate.updateChannel
        : defaultSettings.updateChannel,
  });
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
