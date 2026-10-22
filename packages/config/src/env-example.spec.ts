import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogFor, variableNames } from "./catalog";
import { DEPLOY_SECTIONS } from "./deploy";
import { renderApiEnvExample, renderDeployEnvExample } from "./env-example";
import { loadApiConfig } from "./index";

// The generator cases start real processes (tsx); under a parallel `turbo test`
// the default 5s is not enough.
vi.setConfig({ testTimeout: 60_000 });

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const script = join(packageRoot, "scripts", "generate-env-example.ts");
const tsx = join(packageRoot, "node_modules", ".bin", "tsx");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function rootVersion(): string {
  const parsed: unknown = JSON.parse(read("package.json"));
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }
  throw new Error("package.json has no version");
}

/** `NAME=value` lines of a dotenv-style file (commented lines ignored). */
function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match?.[1] !== undefined) {
      env[match[1]] = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return env;
}

describe("REQ-CFG-4 generated .env.example files", () => {
  it("REQ-CFG-4: apps/api/.env.example matches the schema", () => {
    expect(read("apps/api/.env.example")).toBe(renderApiEnvExample());
  });

  it("REQ-CFG-4: deploy/.env.example matches the schema and the released version", () => {
    expect(read("deploy/.env.example")).toBe(
      renderDeployEnvExample(rootVersion()),
    );
  });

  it("REQ-CFG-4: deploy/.env.example keeps the release-please markers around the version", () => {
    const deploy = read("deploy/.env.example");
    expect(deploy).toMatch(
      /# x-release-please-start-version\nCALIBRA_VERSION=\S+\n# x-release-please-end/,
    );
  });

  it("REQ-CFG-4: the API example is itself a valid development configuration", () => {
    const env = parseEnvFile(read("apps/api/.env.example"));
    expect(env.DATABASE_URL).toBeDefined();
    expect(() => loadApiConfig(env)).not.toThrow();
  });

  it("REQ-CFG-4: every variable of the API example is a schema variable", () => {
    const known = variableNames("api");
    for (const name of Object.keys(
      parseEnvFile(read("apps/api/.env.example")),
    )) {
      expect(known.has(name), `${name} is not in the API schema`).toBe(true);
    }
  });

  it("REQ-CFG-4: the variables setup fills with secrets are the ones the schema marks generated", () => {
    const generatedByExample = new Set(
      catalogFor("api")
        .flatMap((section) => section.entries)
        .filter((entry) => entry.meta.example?.state === "generated")
        .map((entry) => entry.meta.env),
    );

    const devSetup = read("scripts/dev-setup.mjs");
    const block = devSetup.match(/const generated = \{([\s\S]*?)\n\};/)?.[1];
    expect(block, "scripts/dev-setup.mjs `generated` block").toBeDefined();
    const generatedBySetup = new Set(
      [...(block ?? "").matchAll(/^\s{2}([A-Z0-9_]+):/gm)].map(
        (match) => match[1],
      ),
    );

    expect(generatedByExample).toEqual(generatedBySetup);
  });
});

describe("REQ-CFG-4 the deployment files use only declared variables", () => {
  const compose = read("deploy/compose.yaml");

  it("REQ-CFG-4: every x-app-env key is an API or worker variable", () => {
    const block = compose.match(
      /x-app-env: &app-env\n([\s\S]*?)\n\nservices:/,
    )?.[1];
    expect(block, "x-app-env block in deploy/compose.yaml").toBeDefined();
    const keys = [...(block ?? "").matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map(
      (match) => match[1],
    );
    expect(keys.length).toBeGreaterThan(10);

    const known = new Set([
      ...variableNames("api"),
      ...variableNames("worker"),
    ]);
    for (const key of keys) {
      expect(known.has(key ?? ""), `${key} is not an API/worker variable`).toBe(
        true,
      );
    }
  });

  it("REQ-CFG-4: every ${VAR} compose interpolates is documented in deploy/.env.example", () => {
    const documented = new Set(
      DEPLOY_SECTIONS.flatMap((section) =>
        section.variables.map((variable) => variable.name),
      ),
    );
    const used = new Set(
      [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
    );
    for (const name of used) {
      expect(
        documented.has(name ?? ""),
        `${name} is missing from the deploy catalog`,
      ).toBe(true);
    }
  });

  it("REQ-CFG-4: every variable setup.sh sets exists in deploy/.env.example", () => {
    const documented = parseEnvFile(read("deploy/.env.example"));
    const setup = read("deploy/setup.sh");
    // `set_value` appends keys the example does not list (COMPOSE_PROFILES), so
    // only the generated secrets are required to exist.
    for (const match of setup.matchAll(
      /^set_value ([A-Z][A-Z0-9_]*) "\$\((?:random|token)/gm,
    )) {
      expect(documented, `${match[1]} is missing`).toHaveProperty(
        match[1] ?? "",
      );
    }
  });
});

describe("REQ-CFG-4 the generator script", () => {
  const scratch: string[] = [];

  afterEach(() => {
    for (const directory of scratch.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A throwaway repo root holding the committed examples and package.json. */
  function scratchRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "calibra-config-"));
    scratch.push(root);
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "deploy"), { recursive: true });
    cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
    cpSync(
      join(repoRoot, "apps/api/.env.example"),
      join(root, "apps/api/.env.example"),
    );
    cpSync(
      join(repoRoot, "deploy/.env.example"),
      join(root, "deploy/.env.example"),
    );
    return root;
  }

  it("REQ-CFG-4: --check passes on the committed examples", () => {
    const root = scratchRoot();
    expect(() =>
      execFileSync(tsx, [script, "--check", "--root", root], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("REQ-CFG-4: --check fails when an example drifts from the schema, and a plain run repairs it", () => {
    const root = scratchRoot();
    const apiExample = join(root, "apps/api/.env.example");
    writeFileSync(
      apiExample,
      readFileSync(apiExample, "utf8").replace(
        "DATABASE_URL=",
        "DATABASE_URL_RENAMED=",
      ),
    );

    const drifted = spawnSync(tsx, [script, "--check", "--root", root], {
      encoding: "utf8",
    });
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain("apps/api/.env.example is out of date");

    execFileSync(tsx, [script, "--root", root], { stdio: "pipe" });
    expect(readFileSync(apiExample, "utf8")).toBe(renderApiEnvExample());
    expect(spawnSync(tsx, [script, "--check", "--root", root]).status).toBe(0);
  });
});
