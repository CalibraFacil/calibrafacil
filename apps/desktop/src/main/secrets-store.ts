import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import {
  desktopSecretNameSchema,
  desktopSecretStatusSchema,
  desktopSecretWriteSchema,
  type DesktopSecretName,
  type DesktopSecretStatus,
} from "@calibra-facil/contracts";

const secretsDirectory = "secrets";
const secretsFileName = "desktop-secrets.json";
const secretNames = desktopSecretNameSchema.options;

type StoredSecret = {
  ciphertext: string;
  updatedAt: string;
};

type StoredSecretsFile = {
  version: 1;
  secrets: Partial<Record<DesktopSecretName, StoredSecret>>;
};

const emptySecretsFile: StoredSecretsFile = {
  version: 1,
  secrets: {},
};

export class DesktopSecretsStore {
  private current: StoredSecretsFile = emptySecretsFile;
  private loaded = false;
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, secretsDirectory, secretsFileName);
  }

  async load() {
    if (this.loaded) return this.current;

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.current = readStoredSecrets(JSON.parse(raw));
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.current = emptySecretsFile;
        await this.persist();
      }
    }

    this.loaded = true;
    return this.current;
  }

  async getStatuses(): Promise<DesktopSecretStatus[]> {
    await this.load();
    return secretNames.map((name) => this.getStatus(name));
  }

  async set(secret: unknown): Promise<DesktopSecretStatus> {
    const parsed = desktopSecretWriteSchema.parse(secret);

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Electron safeStorage encryption is not available.");
    }

    await this.load();
    this.current = {
      version: 1,
      secrets: {
        ...this.current.secrets,
        [parsed.name]: {
          ciphertext: safeStorage
            .encryptString(parsed.value)
            .toString("base64"),
          updatedAt: new Date().toISOString(),
        },
      },
    };
    await this.persist();
    return this.getStatus(parsed.name);
  }

  async delete(name: unknown): Promise<DesktopSecretStatus> {
    const parsed = desktopSecretNameSchema.parse(name);
    await this.load();

    const secrets = { ...this.current.secrets };
    delete secrets[parsed];
    this.current = {
      version: 1,
      secrets,
    };
    await this.persist();
    return this.getStatus(parsed);
  }

  async read(name: DesktopSecretName): Promise<string | null> {
    await this.load();
    const storedSecret = this.current.secrets[name];
    if (!storedSecret) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    return safeStorage.decryptString(
      Buffer.from(storedSecret.ciphertext, "base64"),
    );
  }

  private getStatus(name: DesktopSecretName): DesktopSecretStatus {
    const storedSecret = this.current.secrets[name];
    return desktopSecretStatusSchema.parse({
      name,
      stored: Boolean(storedSecret),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      updatedAt: storedSecret?.updatedAt ?? null,
    });
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

function readStoredSecrets(value: unknown): StoredSecretsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySecretsFile;
  }

  const secrets = (value as { secrets?: unknown }).secrets;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    return emptySecretsFile;
  }

  const parsedSecrets: StoredSecretsFile["secrets"] = {};
  for (const name of secretNames) {
    const candidate = (secrets as Record<string, unknown>)[name];
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    if (
      typeof record.ciphertext === "string" &&
      typeof record.updatedAt === "string"
    ) {
      parsedSecrets[name] = {
        ciphertext: record.ciphertext,
        updatedAt: record.updatedAt,
      };
    }
  }

  return {
    version: 1,
    secrets: parsedSecrets,
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
