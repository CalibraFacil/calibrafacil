import {
  isTestFile,
  normalizedFilename,
  type RuleContext,
  type RuleModule,
  toRecord,
  type UnknownRecord,
} from "../lib/rule-support.ts";

// TanStack Query keys come from factories (docs/architecture/web-frontend-architecture.md,
// "Query Keys and Tenant Scope"): `features/<domain>/keys.ts` in the lab app,
// `usePortalKeys()` in the portal. The query, every invalidation and every
// cache write call the same factory, so a reshaped key moves them together.
// A literal array at a call site is the hand-typed copy this rule keeps out:
// `queryKey: [...]` in any options object (`useQuery`, `invalidateQueries`,
// `queryOptions`, ...), a literal first argument of a
// QueryClient cache method (`setQueryData([...])`, `getQueryData([...])`)
// and the scope passed to `keepPreviousDataInScope([...])`.
// Scope: apps/web/src/features and apps/portal/src; tests are exempt. The
// factory modules build their arrays outside these positions. The baseline is
// empty: there is no allowance.

const SCOPE_PATTERN = /(^|\/)apps\/(web\/src\/features|portal\/src)\//;

/** QueryClient / hook methods whose first argument is a query key. */
const KEY_ARGUMENT_METHODS = new Set([
  "setQueryData",
  "getQueryData",
  "getQueryState",
  "setQueriesData",
  "getQueriesData",
  "removeQueries",
  "keepPreviousDataInScope",
]);

const MESSAGE =
  'Do not write a query key as a literal array. Build it with the feature\'s key factory (apps/web: features/<domain>/keys.ts; portal: usePortalKeys() from @/lib/portal-keys) so the query and its invalidations share one definition. See docs/architecture/web-frontend-architecture.md, "Query Keys and Tenant Scope".';

function isArrayLiteral(value: unknown): boolean {
  const record = toRecord(value);
  if (record?.type === "ArrayExpression") return true;
  // `cond ? [...] : [...]` and `[...] as const`-style wrappers.
  if (record?.type === "ConditionalExpression") {
    return (
      isArrayLiteral(record.consequent) || isArrayLiteral(record.alternate)
    );
  }
  if (
    record?.type === "TSAsExpression" ||
    record?.type === "TSSatisfiesExpression" ||
    record?.type === "TSNonNullExpression"
  ) {
    return isArrayLiteral(record.expression);
  }
  return false;
}

function calleeName(callee: UnknownRecord | null): string | null {
  if (!callee) return null;
  if (callee.type === "Identifier") {
    return typeof callee.name === "string" ? callee.name : null;
  }
  if (callee.type === "MemberExpression" && callee.computed !== true) {
    const property = toRecord(callee.property);
    return typeof property?.name === "string" ? property.name : null;
  }
  return null;
}

function propertyName(property: UnknownRecord): string | null {
  if (property.computed === true) return null;
  const key = toRecord(property.key);
  if (key?.type === "Identifier" && typeof key.name === "string") {
    return key.name;
  }
  if (key?.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }
  return null;
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow literal-array query keys in apps/web/src/features and apps/portal/src; keys come from the key factories.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!SCOPE_PATTERN.test(filename) || isTestFile(filename)) return {};

    return {
      Property(node: unknown) {
        const property = toRecord(node);
        if (!property || propertyName(property) !== "queryKey") return;
        if (isArrayLiteral(property.value)) {
          context.report({ node: property.value, message: MESSAGE });
        }
      },
      CallExpression(node: unknown) {
        const call = toRecord(node);
        const name = calleeName(toRecord(call?.callee));
        if (!name || !KEY_ARGUMENT_METHODS.has(name)) return;
        const args = call?.arguments;
        if (Array.isArray(args) && isArrayLiteral(args[0])) {
          context.report({ node: args[0], message: MESSAGE });
        }
      },
    };
  },
};

export default rule;
