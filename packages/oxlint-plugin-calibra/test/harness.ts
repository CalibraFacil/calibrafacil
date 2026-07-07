import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Spawn-the-real-oxlint test harness (reference-project pattern). Rules are exercised
// through the actual `oxlint` binary against a temp fixture tree — the same
// loader, parser and config resolution `pnpm lint` uses — instead of a mocked
// rule-tester that could pass while the real integration is broken.
//
// Fixture files are written at their repo-shaped relative paths (e.g.
// apps/web/src/features/x.tsx) because every rule scopes itself by path.

const execFileAsync = promisify(execFile);

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));
const oxlintBin = join(repoRoot, "node_modules", ".bin", "oxlint");
const pluginPath = join(packageRoot, "src", "index.ts");

export type LintOutcome = {
  exitCode: number;
  output: string;
};

export async function lintFixtures(
  ruleName: string,
  files: Record<string, string>,
): Promise<LintOutcome> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "calibra-oxlint-"));
  try {
    await writeFile(
      join(fixtureDir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [pluginPath],
        // Only the rule under test — default categories stay off so the
        // outcome reflects exactly this rule.
        categories: { correctness: "off" },
        rules: { [`calibra/${ruleName}`]: "error" },
      }),
    );

    for (const [relPath, source] of Object.entries(files)) {
      const filePath = join(fixtureDir, relPath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, source);
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        oxlintBin,
        ["--config", ".oxlintrc.json", "."],
        { cwd: fixtureDir },
      );
      return { exitCode: 0, output: `${stdout}${stderr}` };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "number" &&
        "stdout" in error &&
        "stderr" in error
      ) {
        return {
          exitCode: error.code,
          output: `${String(error.stdout)}${String(error.stderr)}`,
        };
      }
      throw error;
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

/** Expect the rule to pass (exit 0, no diagnostic from this rule). */
export async function expectClean(
  ruleName: string,
  files: Record<string, string>,
): Promise<void> {
  const { exitCode, output } = await lintFixtures(ruleName, files);
  if (exitCode !== 0 || output.includes(`calibra(${ruleName})`)) {
    throw new Error(
      `expected calibra/${ruleName} to pass but oxlint reported:\n${output}`,
    );
  }
}

/** Expect the rule to fail with its own diagnostic. */
export async function expectViolation(
  ruleName: string,
  files: Record<string, string>,
): Promise<string> {
  const { exitCode, output } = await lintFixtures(ruleName, files);
  if (exitCode === 0 || !output.includes(`calibra(${ruleName})`)) {
    throw new Error(
      `expected calibra/${ruleName} to report a violation but oxlint passed:\n${output}`,
    );
  }
  return output;
}
