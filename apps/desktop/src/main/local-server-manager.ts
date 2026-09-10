import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { app } from "electron";
import {
  localEnvironmentBootstrapSchema,
  localServerBootstrapConfigSchema,
  type LocalDatabasePartition,
  type LocalEnvironmentBootstrap,
  type LocalServerBootstrapConfig,
} from "@calibra-facil/contracts";

const DEFAULT_LOCAL_HOST = "127.0.0.1";
const DEFAULT_LOCAL_PORT = 4317;
const LOCAL_PORT_ATTEMPTS = 20;
const LOCAL_SERVER_BOOTSTRAP_ENV = "CALIBRA_LOCAL_SERVER_BOOTSTRAP";
const LOCAL_SERVER_BOOTSTRAP_STDIN_ENV = "CALIBRA_LOCAL_SERVER_BOOTSTRAP_STDIN";
const LOCAL_SERVER_ENV_KEYS = [
  LOCAL_SERVER_BOOTSTRAP_ENV,
  LOCAL_SERVER_BOOTSTRAP_STDIN_ENV,
  "CALIBRA_LOCAL_HOST",
  "CALIBRA_LOCAL_PORT",
  "CALIBRA_LOCAL_BOOTSTRAP_TOKEN",
  "CALIBRA_APP_VERSION",
  "CALIBRA_LOCAL_SERVER_VERSION",
  "CALIBRA_LOCAL_DB_PATH",
  "CALIBRA_LOCAL_STORAGE_DIR",
  "CALIBRA_DEVICE_ID",
  "CALIBRA_TENANT_ID",
  "CALIBRA_ORGANIZATION_ID",
  "CALIBRA_UNIT_ID",
  "CALIBRA_USER_ID",
  "CALIBRA_SYNC_ENABLED",
  "CALIBRA_CLOUD_API_URL",
  "CALIBRA_CLOUD_AUTH_TOKEN",
  "CALIBRA_CLOUD_PROXY_TOKEN",
] as const;

type LocalServerStartOptions = {
  cloudAuthToken?: string | null;
  cloudApiUrl?: string | null;
  cloudProxyToken?: string | null;
  /**
   * The account and organization whose database to open. The local server
   * derives the file from this and verifies the ownership record inside it;
   * the host deliberately does not compute a path, so the two cannot disagree.
   */
  partition?: LocalDatabasePartition | null;
  /**
   * The user's persisted preference. Passed through so the scheduler stays
   * dormant for an installation that turned automatic sync off, instead of
   * uploading pending work on every launch.
   */
  autoStartSync?: boolean;
};

type LocalServerCommand = {
  dataRoot: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  dbPath: string;
  storageRoot: string;
};

export type LocalServerManagerState =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "crashed"
  | "restarting";

export class LocalServerManager {
  #process: ChildProcessWithoutNullStreams | null = null;
  #bootstrap: LocalEnvironmentBootstrap | null = null;
  #localApiToken = randomBytes(32).toString("base64url");
  #desktopRunId = randomUUID();
  #localServerRunId = randomUUID();
  #lastStartOptions: LocalServerStartOptions = {};
  #restartAttempts = 0;
  #restartTimer: NodeJS.Timeout | null = null;
  #startAttemptId = 0;
  #startPromise: Promise<LocalEnvironmentBootstrap> | null = null;
  #state: LocalServerManagerState = "stopped";
  #stopping = false;
  #port = Number(process.env.CALIBRA_LOCAL_PORT ?? DEFAULT_LOCAL_PORT);

  readonly host = process.env.CALIBRA_LOCAL_HOST ?? DEFAULT_LOCAL_HOST;

  get state() {
    return this.#state;
  }

  get port() {
    return this.#port;
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  get bootstrap() {
    return this.#bootstrap;
  }

  get runtime() {
    return {
      state: this.#state,
      desktopRunId: this.#desktopRunId,
      localServerRunId: this.#localServerRunId,
      logFilePath: this.logFilePath,
    };
  }

  get logFilePath() {
    return path.join(app.getPath("userData"), "logs", "local-server.log");
  }

  async start(options: LocalServerStartOptions = {}) {
    if (this.#bootstrap && this.#state === "ready") {
      return this.#bootstrap;
    }

    if (this.#startPromise) {
      return this.#startPromise;
    }

    this.#startPromise = this.#start(options).finally(() => {
      this.#startPromise = null;
    });

    return this.#startPromise;
  }

  async #start(options: LocalServerStartOptions = {}) {
    this.#lastStartOptions = options;
    this.#stopping = false;
    this.#state = "starting";
    const startAttemptId = ++this.#startAttemptId;

    if (!process.env.CALIBRA_DESKTOP_SKIP_LOCAL_SERVER) {
      this.#port = await findAvailablePort(this.host, this.#port);
      this.#spawn(options);
    }

    try {
      this.#bootstrap = await this.#waitForReadiness(startAttemptId);
      this.#restartAttempts = 0;
      this.#state = "ready";
      return this.#bootstrap;
    } catch (error) {
      if (this.#stopping || startAttemptId !== this.#startAttemptId) {
        this.#state = "stopped";
      } else {
        this.#state = "crashed";
      }
      throw error;
    }
  }

  stop() {
    this.#stopping = true;
    this.#startAttemptId += 1;
    this.#state = "stopping";
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }

    if (!this.#process || this.#process.killed) {
      this.#bootstrap = null;
      this.#state = "stopped";
      return;
    }

    this.#process.kill();
    this.#process = null;
    this.#bootstrap = null;
    this.#state = "stopped";
  }

  #spawn(options: LocalServerStartOptions) {
    if (this.#process) return;

    this.#localServerRunId = randomUUID();
    const command = this.#getCommand();
    const bootstrapConfig = this.#createBootstrapConfig(command, options);

    this.#process = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: {
        ...sanitizeLocalServerEnvironment(process.env),
        ...command.env,
        [LOCAL_SERVER_BOOTSTRAP_STDIN_ENV]: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#process.stdin.end(JSON.stringify(bootstrapConfig));

    this.#process.stdout.on("data", (chunk) => {
      const message = String(chunk).trim();
      console.log(`[local-server] ${message}`);
      this.#appendLog("stdout", message);
    });

    this.#process.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      console.error(`[local-server] ${message}`);
      this.#appendLog("stderr", message);
    });

    this.#process.once("exit", (code, signal) => {
      const message = `local-server exited with code=${code} signal=${signal}`;
      console.error(message);
      this.#appendLog("exit", message);
      this.#process = null;
      if (!this.#stopping) {
        this.#state = "crashed";
        this.#scheduleRestart();
      } else {
        this.#state = "stopped";
      }
    });
  }

  #scheduleRestart() {
    if (this.#restartTimer || process.env.CALIBRA_DESKTOP_SKIP_LOCAL_SERVER) {
      return;
    }

    const delayMs = Math.min(10_000, 500 * 2 ** this.#restartAttempts);
    this.#restartAttempts += 1;
    this.#state = "restarting";
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      try {
        this.#state = "starting";
        const startAttemptId = ++this.#startAttemptId;
        this.#spawn(this.#lastStartOptions);
        void this.#waitForReadiness(startAttemptId)
          .then((bootstrap) => {
            this.#bootstrap = bootstrap;
            this.#restartAttempts = 0;
            this.#state = "ready";
          })
          .catch((error) => {
            if (this.#stopping || startAttemptId !== this.#startAttemptId) {
              this.#state = "stopped";
              return;
            }
            this.#state = "crashed";
            console.error(
              error instanceof Error
                ? error.message
                : "local-server restart readiness failed",
            );
            this.#scheduleRestart();
          });
      } catch (error) {
        this.#state = "crashed";
        console.error(
          error instanceof Error
            ? error.message
            : "local-server restart failed",
        );
        this.#scheduleRestart();
      }
    }, delayMs);
  }

  #getCommand(): LocalServerCommand {
    if (app.isPackaged) {
      return {
        executable: process.execPath,
        args: [path.join(app.getAppPath(), "dist/local-server/server.cjs")],
        cwd: path.dirname(app.getAppPath()),
        env: { ELECTRON_RUN_AS_NODE: "1" },
        dbPath: path.join(
          app.getPath("userData"),
          "local-data",
          "calibra.sqlite",
        ),
        dataRoot: path.join(app.getPath("userData"), "local-partitions"),
        storageRoot: path.join(app.getPath("userData"), "local-files"),
      };
    }

    const workspaceRoot = path.resolve(app.getAppPath(), "../..");
    return {
      executable: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      args: ["--dir", "apps/local-server", "exec", "tsx", "src/bin.ts"],
      cwd: workspaceRoot,
      env: {},
      dbPath: path.join(workspaceRoot, ".calibra-local", "calibra.sqlite"),
      dataRoot: path.join(workspaceRoot, ".calibra-local", "partitions"),
      storageRoot: path.join(workspaceRoot, ".calibra-local", "files"),
    };
  }

  #createBootstrapConfig(
    command: LocalServerCommand,
    options: LocalServerStartOptions,
  ): LocalServerBootstrapConfig {
    return localServerBootstrapConfigSchema.parse({
      host: this.host,
      port: this.port,
      appVersion: app.getVersion(),
      localServerVersion: app.getVersion(),
      dbPath: process.env.CALIBRA_LOCAL_DB_PATH ?? command.dbPath,
      storageRoot: process.env.CALIBRA_LOCAL_STORAGE_DIR ?? command.storageRoot,
      deviceId: process.env.CALIBRA_DEVICE_ID ?? "local-dev-device",
      tenantId: process.env.CALIBRA_TENANT_ID ?? null,
      dataRoot: command.dataRoot,
      legacyDbPath: command.dbPath,
      // A packaged build must never open a database that belongs to nobody.
      // The server enforces this too; passing it is the host's half.
      requirePartition: app.isPackaged,
      organizationId:
        options.partition?.organizationId ??
        process.env.CALIBRA_ORGANIZATION_ID ??
        null,
      unitId: process.env.CALIBRA_UNIT_ID
        ? Number(process.env.CALIBRA_UNIT_ID)
        : null,
      userId: options.partition?.userId ?? process.env.CALIBRA_USER_ID ?? null,
      syncEnabled: process.env.CALIBRA_SYNC_ENABLED !== "false",
      autoStartSync: options.autoStartSync ?? true,
      bootstrapToken: this.#localApiToken,
      cloudApiUrl:
        options.cloudApiUrl ?? process.env.CALIBRA_CLOUD_API_URL ?? null,
      cloudAuthToken:
        options.cloudAuthToken ?? process.env.CALIBRA_CLOUD_AUTH_TOKEN ?? null,
      cloudProxyToken:
        options.cloudProxyToken ??
        process.env.CALIBRA_CLOUD_PROXY_TOKEN ??
        null,
      desktopRunId: this.#desktopRunId,
      localServerRunId: this.#localServerRunId,
    });
  }

  #appendLog(stream: "stdout" | "stderr" | "exit", message: string) {
    if (!message) return;

    const line = `${new Date().toISOString()} [desktop:${this.#desktopRunId}] [local-server:${this.#localServerRunId}] [${stream}] ${message}\n`;
    const logFilePath = this.logFilePath;
    void mkdir(path.dirname(logFilePath), { recursive: true })
      .then(() => appendFile(logFilePath, line, "utf8"))
      .catch((error) => {
        console.error(
          error instanceof Error
            ? `Failed to append local-server log: ${error.message}`
            : "Failed to append local-server log.",
        );
      });
  }

  async #waitForReadiness(startAttemptId: number) {
    const deadline = Date.now() + 15_000;
    const readinessUrl = `${this.baseUrl}/.well-known/calibra/local-environment`;

    while (Date.now() < deadline) {
      if (this.#stopping || startAttemptId !== this.#startAttemptId) {
        throw new Error("Local server start was cancelled");
      }

      try {
        const response = await fetch(readinessUrl, {
          headers: { "x-calibra-local-token": this.#localApiToken },
        });
        if (response.ok) {
          if (this.#stopping || startAttemptId !== this.#startAttemptId) {
            throw new Error("Local server start was cancelled");
          }

          const bootstrap = localEnvironmentBootstrapSchema.parse(
            await response.json(),
          );

          return {
            ...bootstrap,
            localApiToken: this.#localApiToken,
          };
        }
      } catch {
        if (this.#stopping || startAttemptId !== this.#startAttemptId) {
          throw new Error("Local server start was cancelled");
        }
        // Keep polling until the local server is ready or the deadline expires.
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("Local server did not become ready in time");
  }
}

async function findAvailablePort(host: string, startPort: number) {
  for (
    let port = startPort;
    port < startPort + LOCAL_PORT_ATTEMPTS;
    port += 1
  ) {
    if (await isPortAvailable(host, port)) {
      return port;
    }
  }

  throw new Error(
    `Local server ports ${startPort}-${startPort + LOCAL_PORT_ATTEMPTS - 1} are unavailable. Close the process using those ports or set CALIBRA_LOCAL_PORT to another value.`,
  );
}

function isPortAvailable(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

function sanitizeLocalServerEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of LOCAL_SERVER_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}
