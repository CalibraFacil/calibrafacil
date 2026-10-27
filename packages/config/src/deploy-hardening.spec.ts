import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The one-server deployment (deploy/compose.yaml, deploy/Caddyfile, the
// Dockerfiles) is hardened by configuration that no runtime test of the
// application would notice losing. These checks read the files themselves.

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

/** The text of each service under `services:`, by name. */
function composeServices(): Map<string, string> {
  const compose = read("deploy/compose.yaml");
  const body = compose.slice(compose.indexOf("\nservices:\n") + 1);
  const services = new Map<string, string>();
  let name: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (name) services.set(name, lines.join("\n"));
  };
  for (const line of body.split("\n").slice(1)) {
    if (/^\S/.test(line)) break; // the next top-level key (volumes:)
    const start = line.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (start) {
      flush();
      name = start[1];
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return services;
}

/** `directive -> sources` of a Content-Security-Policy value. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/** The policy a Caddyfile snippet sets, `{$VAR}` placeholders kept. */
function caddyPolicy(snippet: string): Map<string, string[]> {
  const caddyfile = read("deploy/Caddyfile");
  const start = caddyfile.indexOf(`(${snippet}) {`);
  expect(start, `snippet ${snippet} in deploy/Caddyfile`).toBeGreaterThan(-1);
  const block = caddyfile.slice(start, caddyfile.indexOf("\n}\n", start));
  const match = block.match(/header Content-Security-Policy "([^"]+)"/);
  expect(match, `${snippet} sets Content-Security-Policy`).not.toBeNull();
  return parsePolicy(match?.[1] ?? "");
}

function headersFilePolicy(app: "web" | "portal"): Map<string, string[]> {
  const line = read(`apps/${app}/public/_headers`)
    .split("\n")
    .find((entry) => entry.trim().startsWith("Content-Security-Policy:"));
  expect(line, `apps/${app}/public/_headers has a policy`).toBeDefined();
  return parsePolicy((line ?? "").replace(/^\s*Content-Security-Policy:/, ""));
}

describe("deploy/compose.yaml hardening", () => {
  const services = composeServices();

  it("lists the services this check expects", () => {
    expect([...services.keys()].sort()).toEqual(
      [
        "api",
        "backup",
        "caddy",
        "gotenberg",
        "init",
        "mailpit",
        "portal",
        "postgres",
        "s3",
        "web",
        "worker",
      ].sort(),
    );
  });

  it.each([...composeServices().keys()])(
    "%s rotates its logs, has a memory limit and a restart policy",
    (name) => {
      const service = services.get(name) ?? "";
      expect(service).toMatch(/^ {4}logging: \*logging$/m);
      expect(service).toMatch(
        /^ {4}mem_limit: \$\{MEM_LIMIT_[A-Z0-9]+:-[0-9]+[mg]\}$/m,
      );
      expect(service).toMatch(/^ {4}restart: /m);
    },
  );

  it.each([
    "api",
    "worker",
    "web",
    "portal",
    "postgres",
    "gotenberg",
    "caddy",
    "s3",
  ])("%s has a healthcheck", (name) => {
    expect(services.get(name)).toMatch(/^ {4}healthcheck:$/m);
  });

  it.each(["init", "api", "worker", "web", "portal"])(
    "%s drops every Linux capability and cannot gain privileges",
    (name) => {
      expect(services.get(name)).toMatch(/^ {4}<<: \*hardened$/m);
    },
  );

  it("the shared logging block rotates with json-file", () => {
    const compose = read("deploy/compose.yaml");
    expect(compose).toMatch(
      /x-logging: &logging\n {2}driver: json-file\n {2}options:\n {4}max-size: \$\{LOG_MAX_SIZE:-[0-9]+[mg]\}\n {4}max-file: \$\{LOG_MAX_FILE:-[0-9]+\}/,
    );
  });

  it("the worker healthcheck reads the file the worker touches", () => {
    const heartbeat = read("apps/worker/src/heartbeat.ts");
    const path = heartbeat.match(/join\(tmpdir\(\), "([^"]+)"\)/)?.[1];
    expect(path).toBeDefined();
    expect(services.get("worker")).toContain(`/tmp/${path}`);
  });
});

describe("the app images run as an unprivileged user", () => {
  it.each([
    "Dockerfile.api",
    "Dockerfile.worker",
    "Dockerfile.document-worker",
    "Dockerfile.static",
  ])("%s ends with USER bun before its command", (file) => {
    const stages = read(file).split(/^FROM /m);
    const last = stages[stages.length - 1] ?? "";
    const user = last.lastIndexOf("\nUSER bun\n");
    expect(
      user,
      `${file} switches to USER bun in its final stage`,
    ).toBeGreaterThan(-1);
    expect(user).toBeLessThan(last.indexOf("\nCMD "));
  });
});

describe("deploy/Caddyfile", () => {
  const caddyfile = read("deploy/Caddyfile");

  it("blocks /api/cron outside the proxy, before the API is proxied, on both app addresses", () => {
    expect(caddyfile).toMatch(/@cron path \/api\/cron \/api\/cron\/\*/);
    expect(caddyfile).toMatch(/handle @cron \{\n\s+respond 404/);
    for (const address of ["{$APP_URL}", "{$PORTAL_URL}"]) {
      const site = caddyfile.slice(caddyfile.indexOf(`\n${address} {`));
      const body = site.slice(0, site.indexOf("\n}\n"));
      expect(body, `${address} imports block_cron`).toContain(
        "import block_cron",
      );
      expect(body.indexOf("import block_cron")).toBeLessThan(
        body.indexOf("handle /api/*"),
      );
    }
  });

  it("sends the transport and browser security headers on every address", () => {
    const common = caddyfile.slice(
      caddyfile.indexOf("(common) {"),
      caddyfile.indexOf("\n}\n", caddyfile.indexOf("(common) {")),
    );
    for (const header of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(common, header).toContain(header);
    }
  });

  it.each([
    ["csp_web", "web"],
    ["csp_portal", "portal"],
  ] as const)(
    "%s: scripts are same-origin, framing and plugins are off, nothing is looser than _headers",
    (snippet, app) => {
      const policy = caddyPolicy(snippet);
      const hosted = headersFilePolicy(app);

      const scripts = policy.get("script-src") ?? [];
      expect(scripts).toContain("'self'");
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(
        scripts.filter(
          (source) => !source.startsWith("'sha256-") && source !== "'self'",
        ),
      ).toEqual([]);

      expect(policy.get("default-src")).toEqual(["'self'"]);
      expect(policy.get("object-src")).toEqual(["'none'"]);
      expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
      expect(policy.get("base-uri")).toEqual(["'self'"]);

      // Directives the self-hosted policy shares with the hosted one stay equal,
      // except where the self-hosted install has to open a door (documented in
      // the Caddyfile): the file-storage address.
      for (const name of [
        "default-src",
        "object-src",
        "frame-ancestors",
        "base-uri",
        "style-src",
        "font-src",
      ]) {
        expect(policy.get(name), name).toEqual(hosted.get(name));
      }
      // img-src, connect-src and frame-src may only add the storage address
      // (and, for the lab app, the lookups and printer agent it calls).
      expect(policy.get("img-src")).toEqual(
        expect.arrayContaining(hosted.get("img-src") ?? []),
      );
      expect(policy.get("connect-src")).toContain("{$FILES_URL}");
    },
  );

  it("the lab app may frame the certificate preview from the file-storage address", () => {
    expect(caddyPolicy("csp_web").get("frame-src")).toContain("{$FILES_URL}");
  });

  it("the portal CSP pins the hash of the inline theme script of its index.html", () => {
    const html = read("apps/portal/index.html");
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(inline).toHaveLength(1);
    const hash = createHash("sha256")
      .update(inline[0]?.[1] ?? "")
      .digest("base64");
    expect(caddyPolicy("csp_portal").get("script-src")).toContain(
      `'sha256-${hash}'`,
    );
  });

  it("the lab app's index.html has no inline script the policy would block", () => {
    expect(read("apps/web/index.html")).not.toMatch(/<script>/);
  });
});
