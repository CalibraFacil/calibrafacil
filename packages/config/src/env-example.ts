import { catalogFor } from "./catalog.ts";
import {
  DEPLOY_SECTIONS,
  DEPLOY_VERSION_VARIABLE,
  deployDescription,
  type DeployVariable,
} from "./deploy.ts";
import { example, type ExampleSpec, type RuntimeName } from "./define.ts";

/**
 * The `.env.example` files, generated from the schema.
 *
 * `renderApiEnvExample()` and `renderDeployEnvExample()` are pure: the
 * `config:env-example` script writes their output, and a test fails when a
 * committed file differs from it, so the examples cannot drift from the
 * schema.
 */

const WIDTH = 80;

function wrap(text: string, prefix: string): string[] {
  const lines: string[] = [];
  let line = prefix;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.length > prefix.length && line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = prefix;
    }
    line += line.length > prefix.length ? ` ${word}` : word;
  }
  if (line.length > prefix.length) lines.push(line);
  return lines;
}

function heading(title: string): string {
  const head = `# ── ${title} `;
  return head + "─".repeat(Math.max(3, WIDTH - head.length));
}

function valueLine(name: string, spec: ExampleSpec | undefined): string {
  if (!spec) return `# ${name}=`;
  switch (spec.state) {
    case "active":
      return `${name}=${spec.value}`;
    case "commented":
      return `# ${name}=${spec.value}`;
    case "generated":
      return `${name}=`;
  }
}

function section(
  title: string,
  intro: readonly string[],
  variables: readonly string[][],
): string[] {
  return [
    heading(title),
    ...intro.map((line) => (line === "" ? "#" : `# ${line}`)),
    ...variables.flatMap((lines) => ["", ...lines]),
    "",
  ];
}

/** Dependency-free text of `apps/api/.env.example`. */
export function renderApiEnvExample(): string {
  const runtime: RuntimeName = "api";
  const header = [
    "# Calibra Fácil API — environment variables.",
    "#",
    "# `pnpm setup:dev` copies this file to apps/api/.env (gitignored) and fills the",
    "# empty secrets with random values. The defaults point at the services started",
    "# by docker-compose.yml, so local development needs no external account.",
    "#",
    "# Generated from packages/config (`pnpm config:env-example`): edit the schema",
    "# there, not this file. A test fails when the two drift apart.",
    "",
  ];

  const body = catalogFor(runtime).flatMap(({ group, entries }) => {
    const variables = entries
      .filter(({ meta }) => !meta.hidden)
      .map(({ meta }) => {
        const notes = [meta.description.trim()];
        const requiredHere =
          meta.requiredInProduction === true ||
          (Array.isArray(meta.requiredInProduction) &&
            meta.requiredInProduction.includes(runtime));
        if (requiredHere) notes.push("Required in production.");
        if (meta.default !== undefined && !meta.secret) {
          notes.push(`Default: ${String(meta.default)}.`);
        }
        return [
          ...wrap(notes.join(" "), "# "),
          valueLine(
            meta.env,
            meta.example ??
              (meta.default !== undefined && !meta.secret
                ? example.commented(String(meta.default))
                : undefined),
          ),
        ];
      });
    return variables.length === 0
      ? []
      : section(group.title, group.intro, variables);
  });

  return [...header, ...body].join("\n").replace(/\n+$/, "\n");
}

function deployVariableLines(
  variable: DeployVariable,
  version: string,
): string[] {
  const comment = wrap(deployDescription(variable), "# ");
  if (variable.name === DEPLOY_VERSION_VARIABLE) {
    // release-please rewrites the lines between these markers on every release.
    return [
      ...comment,
      "# x-release-please-start-version",
      `${DEPLOY_VERSION_VARIABLE}=${version}`,
      "# x-release-please-end",
    ];
  }
  return [...comment, valueLine(variable.name, variable.example)];
}

/** Text of `deploy/.env.example`; `version` is the release in package.json. */
export function renderDeployEnvExample(version: string): string {
  const header = [
    "# Calibra Fácil, self-hosted: settings for compose.yaml.",
    "#",
    "# ./setup.sh copies this file to .env and fills in the secrets. Keep .env",
    "# private and backed up: losing the master keys makes stored certificates'",
    "# signing keys and integration tokens unreadable.",
    "#",
    "# Generated from packages/config (`pnpm config:env-example`): edit the schema",
    "# there, not this file. A test fails when the two drift apart.",
    "",
  ];

  const body = DEPLOY_SECTIONS.flatMap((deploySection) =>
    section(
      deploySection.title,
      deploySection.intro ?? [],
      deploySection.variables.map((variable) =>
        deployVariableLines(variable, version),
      ),
    ),
  );

  return [...header, ...body].join("\n").replace(/\n+$/, "\n");
}
