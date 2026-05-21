import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalServerManager } from "./local-server-manager";

type SpawnCall = {
  executable: string;
  args: string[];
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    stdio?: string[];
  };
};

type MockChildProcess = EventEmitter & {
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  stdin: {
    end: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
};

const mocks = vi.hoisted(() => {
  const state = {
    userDataPath: "/tmp/calibra-desktop-test",
  };

  return {
    state,
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => "/home/pedro/git/calibra-facil/apps/desktop"),
      getPath: vi.fn(() => state.userDataPath),
      getVersion: vi.fn(() => "1.2.3-test"),
    },
    spawn: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();

  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

const spawnedProcesses: MockChildProcess[] = [];
const spawnCalls: SpawnCall[] = [];
const tempDirectories: string[] = [];
const occupiedServers: Server[] = [];

function createMockChildProcess(): MockChildProcess {
  let killed = false;
  const emitter = new EventEmitter();
  const child: MockChildProcess = Object.assign(emitter, {
    get killed() {
      return killed;
    },
    set killed(value: boolean) {
      killed = value;
    },
    stdin: {
      end: vi.fn(),
    },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      killed = true;
      emitter.emit("exit", null, "SIGTERM");
      return true;
    }),
  });

  return child;
}

function bootstrapResponse(httpBaseUrl = "http://127.0.0.1:4317") {
  return {
    appVersion: "1.2.3-test",
    localServerVersion: "1.2.3-test",
    deviceId: "local-dev-device",
    tenantId: null,
    organizationId: null,
    unitId: null,
    userId: null,
    dbSchemaVersion: 5,
    syncEnabled: true,
    syncState: "idle",
    httpBaseUrl,
    localApiToken: null,
  };
}

function readStdinBootstrapConfig(index = 0) {
  const stdinEnd = spawnedProcesses[index]?.stdin.end;
  expect(stdinEnd).toHaveBeenCalledOnce();
  const payload = stdinEnd?.mock.calls[0]?.[0];
  expect(payload).toEqual(expect.any(String));
  return JSON.parse(String(payload));
}

describe("LocalServerManager", () => {
  beforeEach(() => {
    spawnedProcesses.length = 0;
    spawnCalls.length = 0;
    mocks.state.userDataPath = mkdtempSync(
      path.join(os.tmpdir(), "calibra-desktop-test-"),
    );
    tempDirectories.push(mocks.state.userDataPath);
    mocks.spawn.mockImplementation(
      (executable: string, args: string[], options: SpawnCall["options"]) => {
        const child = createMockChildProcess();
        spawnedProcesses.push(child);
        spawnCalls.push({ executable, args, options });
        return child;
      },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        json: async () => bootstrapResponse(new URL(String(input)).origin),
      })),
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const server of occupiedServers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
    delete process.env.CALIBRA_DESKTOP_SKIP_LOCAL_SERVER;
    delete process.env.CALIBRA_LOCAL_PORT;
  });

  it("starts the local server with desktop bootstrap over stdin", async () => {
    const manager = new LocalServerManager();

    const bootstrap = await manager.start({ cloudAuthToken: "cloud-token" });

    expect(manager.state).toBe("ready");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.executable).toMatch(/pnpm(?:\.cmd)?$/);
    expect(spawnCalls[0]?.args).toEqual([
      "--dir",
      "apps/local-server",
      "exec",
      "tsx",
      "src/bin.ts",
    ]);
    expect(spawnCalls[0]?.args).toContain("tsx");
    expect(spawnCalls[0]?.options.cwd).toBe("/home/pedro/git/calibra-facil");
    expect(spawnCalls[0]?.options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(spawnCalls[0]?.options.env.CALIBRA_LOCAL_HOST).toBeUndefined();
    expect(spawnCalls[0]?.options.env.CALIBRA_LOCAL_PORT).toBeUndefined();
    expect(spawnCalls[0]?.options.env.CALIBRA_CLOUD_AUTH_TOKEN).toBeUndefined();
    expect(
      spawnCalls[0]?.options.env.CALIBRA_LOCAL_SERVER_BOOTSTRAP,
    ).toBeUndefined();
    expect(
      spawnCalls[0]?.options.env.CALIBRA_LOCAL_SERVER_BOOTSTRAP_STDIN,
    ).toBe("1");
    const bootstrapConfig = readStdinBootstrapConfig();
    expect(bootstrapConfig).toMatchObject({
      host: "127.0.0.1",
      port: 4317,
      appVersion: "1.2.3-test",
      localServerVersion: "1.2.3-test",
      cloudAuthToken: "cloud-token",
      bootstrapToken: expect.any(String),
      desktopRunId: expect.any(String),
      localServerRunId: expect.any(String),
    });
    expect(manager.runtime).toMatchObject({
      state: "ready",
      desktopRunId: bootstrapConfig.desktopRunId,
      localServerRunId: bootstrapConfig.localServerRunId,
      logFilePath: expect.stringContaining("local-server.log"),
    });
    expect(bootstrap.localApiToken).toEqual(expect.any(String));
  });

  it("coalesces concurrent start calls into one child process", async () => {
    const manager = new LocalServerManager();

    const [firstBootstrap, secondBootstrap] = await Promise.all([
      manager.start({ cloudAuthToken: "cloud-token" }),
      manager.start({ cloudAuthToken: "second-token" }),
    ]);

    expect(manager.state).toBe("ready");
    expect(spawnCalls).toHaveLength(1);
    expect(readStdinBootstrapConfig()).toMatchObject({
      cloudAuthToken: "cloud-token",
    });
    expect(firstBootstrap).toBe(secondBootstrap);
  });

  it("uses the next available port when the preferred local port is occupied", async () => {
    process.env.CALIBRA_LOCAL_PORT = "48417";
    const occupiedServer = await listenOnPort("127.0.0.1", 48417);
    occupiedServers.push(occupiedServer);

    const manager = new LocalServerManager();
    const bootstrap = await manager.start();

    expect(manager.port).toBe(48418);
    expect(manager.baseUrl).toBe("http://127.0.0.1:48418");
    expect(spawnCalls[0]?.options.env.CALIBRA_LOCAL_PORT).toBeUndefined();
    expect(readStdinBootstrapConfig()).toMatchObject({
      port: 48418,
    });
    expect(bootstrap.httpBaseUrl).toBe("http://127.0.0.1:48418");
  });

  it("passes the desktop cloud sync proxy to the local server", async () => {
    const manager = new LocalServerManager();

    await manager.start({
      cloudApiUrl: "http://127.0.0.1:4321",
      cloudProxyToken: "proxy-token",
    });

    expect(readStdinBootstrapConfig()).toMatchObject({
      cloudApiUrl: "http://127.0.0.1:4321",
      cloudProxyToken: "proxy-token",
    });
  });

  it("restarts the local server after an unexpected exit", async () => {
    vi.useFakeTimers();

    const manager = new LocalServerManager();
    await manager.start({ cloudAuthToken: "cloud-token" });

    spawnedProcesses[0]?.emit("exit", 1, null);
    expect(manager.state).toBe("restarting");
    await vi.advanceTimersByTimeAsync(500);

    expect(manager.state).toBe("ready");
    expect(spawnCalls).toHaveLength(2);
    expect(readStdinBootstrapConfig(1)).toMatchObject({
      cloudAuthToken: "cloud-token",
    });
    expect(manager.bootstrap?.localApiToken).toEqual(expect.any(String));
  });

  it("does not restart after an intentional stop", async () => {
    vi.useFakeTimers();

    const manager = new LocalServerManager();
    await manager.start();

    manager.stop();
    expect(manager.state).toBe("stopped");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnedProcesses[0]?.kill).toHaveBeenCalledOnce();
  });

  it("does not become ready after being stopped during startup", async () => {
    let resolveFetch!: (response: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const manager = new LocalServerManager();
    const start = manager.start();

    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));
    expect(manager.state).toBe("starting");

    manager.stop();
    resolveFetch({
      ok: true,
      json: async () => bootstrapResponse(),
    });

    await expect(start).rejects.toThrow("Local server start was cancelled");
    expect(manager.state).toBe("stopped");
    expect(manager.bootstrap).toBeNull();
    expect(spawnedProcesses[0]?.kill).toHaveBeenCalledOnce();
    await vi.waitFor(async () => {
      await expect(readFile(manager.logFilePath, "utf8")).resolves.toContain(
        "signal=SIGTERM",
      );
    });
  });

  it("captures local server process output to a userData log file", async () => {
    const manager = new LocalServerManager();
    await manager.start();

    spawnedProcesses[0]?.stdout.emit("data", "server ready\n");
    spawnedProcesses[0]?.stderr.emit("data", "server warning\n");
    spawnedProcesses[0]?.emit("exit", 1, null);

    await vi.waitFor(async () => {
      const log = await readFile(manager.logFilePath, "utf8");
      expect(log).toContain("[stdout] server ready");
      expect(log).toContain("[stderr] server warning");
      expect(log).toContain("[exit] local-server exited with code=1");
      expect(log).toContain("[desktop:");
      expect(log).toContain("[local-server:");
    });
  });
});

function listenOnPort(host: string, port: number) {
  const server = createServer();

  return new Promise<Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
