import {
  type Baseline,
  baselineFor,
  importSourceOf,
  isTestFile,
  normalizedFilename,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";
import { RAW_DB_BASELINE } from "../lib/raw-db-baseline.ts";

// A route handler that queries through the global Drizzle `db` has to remember
// the organization predicate on every statement (the tenant SQL guard only
// catches a forgotten one in the integration tier). P2-2: routes query through
// an org-bound handle instead - `orgDb(organizationId)` from
// apps/api/src/lib/org-db.ts, i.e. `forOrg(db, organizationId)` from
// @calibra-facil/db/for-org - which adds the predicate itself.
//
// So apps/api/src/routes may not use the `db` exported by @calibra-facil/db.
// The routes that still do are grandfathered as exact per-file counts of
// references to the binding (lib/raw-db-baseline.ts, same ratchet as
// no-json-error-body-in-routes): a file may never gain one, and - unlike the
// other ratchets - a count that is higher than the file's real number of uses
// is reported too, so the allowance shrinks in the same change that migrates a
// handler. An unlisted file must have zero.
//
// Statements that are cross-organization by design (sign-in memberships, the
// portal scope resolver, public tokens) live in a lib module with a reason in
// tenant-sql-allowlist.ts, not in a route.

const ROUTES_PATTERN = /(^|\/)apps\/api\/src\/routes\//;
const DB_PACKAGE = "@calibra-facil/db";

// Keys that are not part of the program structure (the token and comment lists
// repeat identifiers as tokens; `parent` would loop).
const SKIPPED_KEYS = new Set(["parent", "tokens", "comments", "loc", "range"]);
const MAX_DEPTH = 400;

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

// The raw handle is exported as `db` and, as a function, `getDb()`. The system
// (owner) path is raw too: `systemDb` / `getSystemDb()`. A route reaches it only
// through a named lib function that says why the statement is cross-organization.
const RAW_EXPORTS = new Set(["db", "getDb", "systemDb", "getSystemDb"]);

type Bindings = {
  /** Local names bound to `db` / `getDb` (from the package or from any module). */
  names: Set<string>;
  /** Local names of `import * as x from "@calibra-facil/db"`. */
  namespaces: Set<string>;
};

/**
 * What the file binds to the raw handle. `db` / `getDb` imported BY NAME from any
 * module counts, not only from @calibra-facil/db: a lib that re-exports the raw
 * handle for routes to import would otherwise be a way around the rule.
 */
function dbBindings(program: UnknownRecord): Bindings {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const body = program.body;
  if (!Array.isArray(body)) return { names, namespaces };
  for (const statement of body) {
    const record = toRecord(statement);
    if (record?.type !== "ImportDeclaration") continue;
    const specifiers = record.specifiers;
    if (!Array.isArray(specifiers)) continue;
    const fromPackage = importSourceOf(record) === DB_PACKAGE;
    for (const specifier of specifiers) {
      const spec = toRecord(specifier);
      const local = toRecord(spec?.local);
      if (typeof local?.name !== "string") continue;
      if (spec?.type === "ImportNamespaceSpecifier" && fromPackage) {
        namespaces.add(local.name);
        continue;
      }
      if (spec?.type !== "ImportSpecifier") continue;
      const imported = toRecord(spec.imported);
      const importedName = imported?.name ?? imported?.value;
      if (typeof importedName === "string" && RAW_EXPORTS.has(importedName)) {
        names.add(local.name);
      }
    }
  }
  return { names, namespaces };
}

/** `import("@calibra-facil/db")`, in either AST spelling. */
function isDynamicDbImport(record: UnknownRecord): boolean {
  if (record.type === "ImportExpression") {
    return importSourceOf(record) === DB_PACKAGE;
  }
  if (record.type !== "CallExpression") return false;
  if (toRecord(record.callee)?.type !== "Import") return false;
  const args = record.arguments;
  return Array.isArray(args) && toRecord(args[0])?.value === DB_PACKAGE;
}

/**
 * `export { db } from "..."` / `export * from "@calibra-facil/db"` in a route:
 * the route would publish the raw handle for others to import.
 */
function isRawReExport(record: UnknownRecord): boolean {
  if (record.type === "ExportAllDeclaration") {
    return importSourceOf(record) === DB_PACKAGE;
  }
  if (record.type !== "ExportNamedDeclaration") return false;
  if (importSourceOf(record) === null) return false;
  const specifiers = record.specifiers;
  if (!Array.isArray(specifiers)) return false;
  return specifiers.some((specifier) => {
    const local = toRecord(toRecord(specifier)?.local);
    const name = local?.name ?? local?.value;
    return typeof name === "string" && RAW_EXPORTS.has(name);
  });
}

/** An Identifier that is a reference to the binding, not a name that merely matches. */
function isReference(
  node: UnknownRecord,
  parent: UnknownRecord | null,
  key: string | null,
): boolean {
  switch (parent?.type) {
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return false;
    case "MemberExpression":
      // `x.db` names a property; `db.x` references the binding.
      return !(key === "property" && parent.computed !== true);
    case "Property":
    case "PropertyDefinition":
    case "MethodDefinition":
      // `{ db: 1 }` names a key; shorthand `{ db }` is counted through `value`.
      return !(key === "key" && parent.computed !== true);
    default:
      return node.type === "Identifier";
  }
}

/**
 * A namespace identifier is a use when it reaches `db` / `getDb` (`pkg.db`) or
 * is passed along whole; `pkg.setQueryObserver` is not.
 */
function isNamespaceUse(
  parent: UnknownRecord | null,
  key: string | null,
): boolean {
  if (parent?.type === "ImportNamespaceSpecifier") return false;
  if (parent?.type !== "MemberExpression" || key !== "object") return true;
  if (parent.computed === true) return true;
  const property = toRecord(parent.property);
  return typeof property?.name === "string" && RAW_EXPORTS.has(property.name);
}

function collectReferences(
  program: UnknownRecord,
  bindings: Bindings,
): unknown[] {
  const { names, namespaces } = bindings;
  const found: unknown[] = [];
  const visit = (
    node: unknown,
    parent: UnknownRecord | null,
    key: string | null,
    depth: number,
  ) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, key, depth + 1);
      return;
    }
    const record = toRecord(node);
    if (!record) return;
    if (isDynamicDbImport(record) || isRawReExport(record)) {
      found.push(record);
      return;
    }
    if (
      record.type === "Identifier" &&
      typeof record.name === "string" &&
      namespaces.has(record.name) &&
      isNamespaceUse(parent, key)
    ) {
      found.push(record);
      return;
    }
    if (
      record.type === "Identifier" &&
      typeof record.name === "string" &&
      names.has(record.name) &&
      isReference(record, parent, key)
    ) {
      found.push(record);
      return;
    }
    for (const childKey of Object.keys(record)) {
      if (SKIPPED_KEYS.has(childKey)) continue;
      visit(
        record[childKey],
        typeof record.type === "string" ? record : parent,
        childKey,
        depth + 1,
      );
    }
  };
  visit(program, null, null, 0);
  return found;
}

/**
 * The baseline in force: the committed one, or `{ baseline: { "<path suffix>":
 * <count> } }` from the rule options. The option exists for the rule's own tests
 * (they inject entries so the exact-count / +1 / stale branches stay covered while
 * the committed baseline is empty); the repo config never sets it.
 */
function baselineInForce(context: RuleContext): Baseline {
  const options = toRecord(context.options?.[0]);
  const injected = toRecord(options?.baseline);
  if (!injected) return RAW_DB_BASELINE;
  const entries: Array<[string, number]> = [];
  for (const [file, count] of Object.entries(injected)) {
    if (typeof count === "number") entries.push([file, count]);
  }
  return new Map(entries);
}

const USE_MESSAGE =
  "Routes do not query through the global db: take an org-bound handle with orgDb(organizationId) from apps/api/src/lib/org-db.ts (forOrg from @calibra-facil/db/for-org), which adds the organization predicate to every statement. Cross-organization lookups belong in a lib module with a reason in tenant-sql-allowlist.ts.";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ratchet: apps/api routes may not use the raw global db; use the org-bound handle (forOrg).",
    },
    schema: [
      {
        type: "object",
        properties: {
          baseline: {
            type: "object",
            additionalProperties: { type: "number" },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!ROUTES_PATTERN.test(filename) || isTestFile(filename)) return {};

    const allowed = baselineFor(baselineInForce(context), filename);
    return {
      Program(program: unknown) {
        const root = toRecord(program);
        if (!root) return;
        const found = collectReferences(root, dbBindings(root));

        for (const reference of found.slice(allowed)) {
          context.report({ node: reference, message: USE_MESSAGE });
        }
        if (found.length < allowed) {
          context.report({
            node: program,
            message: `The raw-db baseline for this file is stale: it allows ${allowed} references to the global db but only ${found.length} remain. Lower (or delete) its entry in packages/oxlint-plugin-calibra/src/lib/raw-db-baseline.ts to ${found.length}.`,
          });
        }
      },
    };
  },
};

export default rule;
