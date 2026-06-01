import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const roots = ["apps", "packages"];
const allowedFiles = new Set([
  "apps/web/src/hooks/use-mount-effect.ts",
  "apps/portal/src/hooks/use-mount-effect.ts",
  "apps/backoffice/src/hooks/use-mount-effect.ts",
]);
const ignoredDirectories = new Set([
  ".next",
  ".react-email",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const checkedExtensions = new Set([".ts", ".tsx"]);
const violations = [];

for (const root of roots) {
  scanDirectory(root);
}

if (violations.length > 0) {
  console.error(
    [
      "Direct useEffect usage is banned. Use derived state, event handlers, data-fetching hooks, keyed remounts, or useMountEffect.",
      "Allowed raw useEffect wrappers:",
      ...Array.from(allowedFiles, (file) => `  - ${file}`),
      "",
      "Violations:",
      ...violations.map(
        ({ filePath, lineNumber, line }) =>
          `  - ${filePath}:${lineNumber}: ${line.trim()}`,
      ),
    ].join("\n"),
  );
  process.exit(1);
}

console.log("No direct useEffect usage found outside useMountEffect wrappers.");

function scanDirectory(directory) {
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      if (!ignoredDirectories.has(entry)) {
        scanDirectory(absolutePath);
      }
      continue;
    }

    if (!stats.isFile() || !isCheckedFile(absolutePath)) {
      continue;
    }

    const filePath = normalizePath(relative(process.cwd(), absolutePath));
    if (allowedFiles.has(filePath)) {
      continue;
    }

    const source = readFileSync(absolutePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (/\buseEffect\b/.test(line)) {
        violations.push({ filePath, lineNumber: index + 1, line });
      }
    }
  }
}

function isCheckedFile(filePath) {
  for (const extension of checkedExtensions) {
    if (filePath.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function normalizePath(filePath) {
  return filePath.split(sep).join("/");
}
