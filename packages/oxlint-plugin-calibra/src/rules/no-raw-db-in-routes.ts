import {
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

/** Local names the file binds to the `db` export of @calibra-facil/db. */
function dbLocalNames(program: UnknownRecord): Set<string> {
  const names = new Set<string>();
  const body = program.body;
  if (!Array.isArray(body)) return names;
  for (const statement of body) {
    const record = toRecord(statement);
    if (record?.type !== "ImportDeclaration") continue;
    if (importSourceOf(record) !== DB_PACKAGE) continue;
    const specifiers = record.specifiers;
    if (!Array.isArray(specifiers)) continue;
    for (const specifier of specifiers) {
      const spec = toRecord(specifier);
      if (spec?.type !== "ImportSpecifier") continue;
      const imported = toRecord(spec.imported);
      if (imported?.name !== "db") continue;
      const local = toRecord(spec.local);
      if (typeof local?.name === "string") names.add(local.name);
    }
  }
  return names;
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

function collectReferences(
  program: UnknownRecord,
  names: ReadonlySet<string>,
): unknown[] {
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

const USE_MESSAGE =
  "Routes do not query through the global db: take an org-bound handle with orgDb(organizationId) from apps/api/src/lib/org-db.ts (forOrg from @calibra-facil/db/for-org), which adds the organization predicate to every statement. Cross-organization lookups belong in a lib module with a reason in tenant-sql-allowlist.ts.";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ratchet: apps/api routes may not use the raw global db; use the org-bound handle (forOrg).",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!ROUTES_PATTERN.test(filename) || isTestFile(filename)) return {};

    const allowed = baselineFor(RAW_DB_BASELINE, filename);
    return {
      Program(program: unknown) {
        const root = toRecord(program);
        if (!root) return;
        const found = collectReferences(root, dbLocalNames(root));

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
