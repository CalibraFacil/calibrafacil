// Minimal structural typings + shared helpers for the calibra oxlint plugin
// oxlint's JS-plugin API is ESLint-shaped: a rule exposes
// `create(context)` returning ESTree visitors. We type only the slice we read
// (import sources and specifier names) instead of depending on a full ESTree
// type package — the rules fail closed on unexpected shapes.

export interface RuleContext {
  /** Absolute path of the file being linted. */
  readonly filename: string;
  report(descriptor: { node: unknown; message: string }): void;
}

export type RuleVisitor = (node: unknown) => void;

export interface RuleModule {
  meta: {
    type: "problem";
    docs: { description: string };
  };
  create(context: RuleContext): Record<string, RuleVisitor | undefined>;
}

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

/** The string source of an import/export-from/dynamic-import node, if any. */
export function importSourceOf(node: unknown): string | null {
  const record = toRecord(node);
  const source = record ? toRecord(record.source) : null;
  const value = source?.value;
  return typeof value === "string" ? value : null;
}

/**
 * Imported (not local-alias) names of an ImportDeclaration's named specifiers.
 * `import { useSearch as s }` yields "useSearch".
 */
export function importedNamesOf(node: unknown): string[] {
  const record = toRecord(node);
  const specifiers = record?.specifiers;
  if (!Array.isArray(specifiers)) return [];

  const names: string[] = [];
  for (const specifier of specifiers) {
    const spec = toRecord(specifier);
    if (spec?.type !== "ImportSpecifier") continue;
    const imported = toRecord(spec.imported);
    if (typeof imported?.name === "string") names.push(imported.name);
    // `import { "useSearch" as s }` string-literal form.
    else if (typeof imported?.value === "string") names.push(imported.value);
  }
  return names;
}

/** Forward-slash form of the linted file's path. */
export function normalizedFilename(context: RuleContext): string {
  return context.filename.replaceAll("\\", "/");
}

/**
 * Resolve a relative import against the importing file, POSIX-style, so
 * `apps/web/src/a.ts` importing `../../../api/src/x` can be checked against
 * repo-layout patterns. Non-relative sources return null.
 */
export function resolveRelativeImport(
  filename: string,
  source: string,
): string | null {
  if (!source.startsWith(".")) return null;
  const base = filename.split("/").slice(0, -1);
  for (const segment of source.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  return base.join("/");
}

/**
 * LEGACY_BASELINE ratchet: existing violations are
 * grandfathered as an exact per-file count; net-new occurrences fail. An
 * unlisted file must have zero. Keys are repo-relative path suffixes.
 */
export type Baseline = ReadonlyMap<string, number>;

export function baselineFor(baseline: Baseline, filename: string): number {
  const normalized = filename.replaceAll("\\", "/");
  for (const [suffix, count] of baseline) {
    if (normalized.endsWith(suffix)) return count;
  }
  return 0;
}

/** Per-file occurrence counter honoring the baseline allowance. */
export function createRatchet(baseline: Baseline, filename: string) {
  const allowed = baselineFor(baseline, filename);
  let seen = 0;
  return {
    /** True when this occurrence exceeds the grandfathered allowance. */
    exceeds(): boolean {
      seen += 1;
      return seen > allowed;
    },
  };
}

const TEST_FILE_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\/)/;

export function isTestFile(filename: string): boolean {
  return TEST_FILE_PATTERN.test(filename.replaceAll("\\", "/"));
}
