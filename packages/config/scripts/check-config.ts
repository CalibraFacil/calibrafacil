// Validates an environment against the configuration schema without starting
// anything (run it before a deploy):
//
//   pnpm config:check --runtime api --env-file path/to/prod.env
//   pnpm config:check --runtime worker --env-file path/to/prod.env
//   pnpm config:check --runtime api            # the current process environment
//
// Run it from the repository root: a relative --env-file is resolved from the
// current directory.
//
// --runtime api|worker|local-server   which schema to check against (required)
// --env-file <path>                   read KEY=VALUE lines from a file INSTEAD of
//                                     the process environment
// --production                        apply the production requirements even if
//                                     the environment does not set NODE_ENV=production
//
// (Node reads `--env-file` itself too, so a missing file is reported by Node.)
//
// Prints the aggregated report (variable names and reasons, never values).
// Exit codes: 0 valid, 1 invalid configuration, 2 usage error.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHECKABLE_RUNTIMES,
  checkConfig,
  isCheckableRuntime,
  parseEnvFile,
} from "../src/check";

function usage(message: string): never {
  console.error(
    `${message}\nUsage: config:check --runtime ${CHECKABLE_RUNTIMES.join("|")} [--env-file <path>] [--production]`,
  );
  process.exit(2);
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    usage(`${name} needs a value`);
  }
  return value;
}

const args = process.argv.slice(2);
const runtime = option(args, "--runtime");
if (runtime === undefined) usage("--runtime is required");
if (!isCheckableRuntime(runtime)) usage(`unknown runtime "${runtime}"`);

const envFile = option(args, "--env-file");
let env: Record<string, string | undefined> = process.env;
if (envFile !== undefined) {
  const path = resolve(process.cwd(), envFile);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    usage(`cannot read ${envFile}`);
  }
  const parsed = parseEnvFile(contents);
  if (parsed.problems.length > 0) {
    console.error(
      `${envFile} has malformed lines:\n${parsed.problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  env = parsed.env;
}

const result = checkConfig(runtime, env, {
  production: args.includes("--production"),
});

if (result.ok) {
  console.log(result.report);
} else {
  console.error(result.report);
  process.exit(1);
}
