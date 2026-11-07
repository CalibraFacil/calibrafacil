import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIME_ENV_GLOBAL,
  RUNTIME_ENV_PREFIX,
  runtimeEnv,
} from "./runtime-env";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtimeEnv", () => {
  it("prefers the value the container served in /runtime-env.js", () => {
    vi.stubGlobal("window", {
      [RUNTIME_ENV_GLOBAL]: {
        VITE_PORTAL_APP_URL: "https://portal.lab.example",
      },
    });

    expect(runtimeEnv("VITE_PORTAL_APP_URL", "https://built.example")).toBe(
      "https://portal.lab.example",
    );
  });

  it("falls back to the build-time value when unset, blank or not a string", () => {
    vi.stubGlobal("window", {
      [RUNTIME_ENV_GLOBAL]: { VITE_A: "  ", VITE_B: 42 },
    });

    expect(runtimeEnv("VITE_A", "built-a")).toBe("built-a");
    expect(runtimeEnv("VITE_B", "built-b")).toBe("built-b");
    expect(runtimeEnv("VITE_C", undefined)).toBeUndefined();
  });

  it("uses the build-time value outside the browser, or before /runtime-env.js ran", () => {
    expect(runtimeEnv("VITE_PORTAL_APP_URL", "https://built.example")).toBe(
      "https://built.example",
    );

    vi.stubGlobal("window", {});
    expect(runtimeEnv("VITE_PORTAL_APP_URL", "https://built.example")).toBe(
      "https://built.example",
    );
  });
});

describe("the static server and the runtime-env.js defaults agree with the readers", () => {
  it("scripts/static-server.ts serves the global and the prefix the readers use", () => {
    const server = readFileSync(
      join(repoRoot, "scripts/static-server.ts"),
      "utf8",
    );

    expect(server).toContain(`window.${RUNTIME_ENV_GLOBAL} =`);
    expect(server).toContain(`startsWith("${RUNTIME_ENV_PREFIX}")`);
  });

  it.each([
    "apps/web/public/runtime-env.js",
    "apps/portal/public/runtime-env.js",
  ])("%s defaults the same global", (file) => {
    const script = readFileSync(join(repoRoot, file), "utf8");

    expect(script).toContain(
      `window.${RUNTIME_ENV_GLOBAL} = window.${RUNTIME_ENV_GLOBAL} || {};`,
    );
  });
});
