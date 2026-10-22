import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "@calibra-facil/config";
import { describe, expect, it } from "vitest";
import { readLocalServerConfig } from "./bootstrap";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("local server start-up configuration (REQ-CFG-2)", () => {
  it("REQ-CFG-2: an invalid port or cloud URL fails with one aggregated error naming both", () => {
    let error: unknown;
    try {
      readLocalServerConfig({
        CALIBRA_LOCAL_PORT: "not-a-port",
        CALIBRA_CLOUD_API_URL: "not a url",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const message = error instanceof Error ? error.message : "";
    expect(message).toMatch(/^Invalid local-server configuration/);
    expect(message).toContain("CALIBRA_LOCAL_PORT");
    expect(message).toContain("CALIBRA_CLOUD_API_URL");
    expect(message).not.toContain("not-a-port");
  });

  it("REQ-CFG-2: an empty environment keeps the development defaults", () => {
    expect(readLocalServerConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 4317,
      syncEnabled: true,
      autoStartSync: true,
      deviceId: "local-dev-device",
      unitId: null,
    });
  });

  it("REQ-CFG-2: the bin exits non-zero with the aggregated message before listening", () => {
    const run = spawnSync("pnpm", ["exec", "tsx", "src/bin.ts"], {
      cwd: serverRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        CALIBRA_LOCAL_PORT: "not-a-port",
      },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/Invalid local-server configuration/);
    expect(run.stderr).toContain("CALIBRA_LOCAL_PORT");
    expect(run.stdout).not.toContain("listening");
  });
});
