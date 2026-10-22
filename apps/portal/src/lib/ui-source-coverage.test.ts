import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// styles.css tells Tailwind to skip the @calibra-facil/ui components the portal
// never renders (`@source not ...`), which keeps their utilities out of the
// render-blocking CSS. The failure mode is silent: import one of them later and
// it renders unstyled. This guard turns that into a failing test.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function excludedUiComponents(): string[] {
  const css = readFileSync(join(srcDir, "styles.css"), "utf8");
  const match =
    /@source not "[^"]*packages\/ui\/src\/components\/\{([^}]+)\}\.tsx"/.exec(
      css,
    );
  return match?.[1]?.split(",").map((name) => name.trim()) ?? [];
}

function importedUiComponents(): Map<string, string> {
  const imported = new Map<string, string>();
  for (const file of sourceFiles(srcDir)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /["']@calibra-facil\/ui\/([a-z-]+)["']/g,
    )) {
      const name = match[1];
      if (name) imported.set(name, file);
    }
  }
  return imported;
}

const componentsDir = join(
  srcDir,
  "..",
  "..",
  "..",
  "packages",
  "ui",
  "src",
  "components",
);

/** The component plus every sibling component it imports, transitively. */
function withDependencies(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return seen;
  seen.add(name);
  const file = join(componentsDir, `${name}.tsx`);
  // `utils`, `status-tone`, `panel-styles`, ... live outside components/.
  if (!existsSync(file)) return seen;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/from ["']\.\/([a-z-]+)["']/g)) {
    if (match[1]) withDependencies(match[1], seen);
  }
  return seen;
}

describe("portal Tailwind sources for @calibra-facil/ui", () => {
  it("REQ-UI-1: excludes some components and finds the exclusion list", () => {
    expect(excludedUiComponents().length).toBeGreaterThan(0);
  });

  it("REQ-UI-1: never excludes a package component the portal imports", () => {
    const excluded = new Set(excludedUiComponents());
    const imported = importedUiComponents();

    const unstyled = [...imported].flatMap(([name, file]) =>
      [...withDependencies(name)]
        .filter((dependency) => excluded.has(dependency))
        .map((dependency) => [dependency, file]),
    );

    expect(
      unstyled.map(([name, file]) => `${name} (needed by ${file})`),
    ).toEqual([]);
  });
});
