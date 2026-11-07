import {
  BASELINE_OPTION_SCHEMA,
  baselineInForce,
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
  toRecord,
  type UnknownRecord,
} from "../lib/rule-support.ts";

// Domain failures in apps/api/src/routes must be thrown as DomainErrors
// (apps/api/src/lib/domain-errors.ts) so every client gets a stable `code`,
// instead of hand-built `c.json({ error: "<texto>" }, status)` bodies.
// Convention: docs/architecture/api-client-contract.md.
//
// ~1000 legacy sites predate the convention. They are grandfathered as exact
// per-file counts (LEGACY_BASELINE, same ratchet as the other calibra rules):
// a file may never gain one, and a migrated site should lower its file's
// count in the same change. An unlisted file must have zero.

const ROUTES_PATTERN =
  /(^|\/)apps\/api\/src\/(routes|domains\/[^/]+\/routes)\//;

const LEGACY_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/routes/customers.ts", 1],
  ["apps/api/src/routes/finance/erp.ts", 1],
  ["apps/api/src/routes/public-signup.ts", 1],
  ["apps/api/src/routes/sso.ts", 1],
]);

const MESSAGE =
  'Do not build a domain failure by hand with c.json({ error }, status). Throw a DomainError (notFound/invalid/conflict/... from apps/api/src/lib/domain-errors.ts) with a code from @calibra-facil/contracts so clients get a stable "code". See docs/architecture/api-client-contract.md.';

function isJsonCallee(callee: UnknownRecord | null): boolean {
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  return toRecord(callee.property)?.name === "json";
}

function keyName(property: UnknownRecord): string | null {
  if (property.type !== "Property") return null;
  const key = toRecord(property.key);
  if (typeof key?.name === "string") return key.name;
  if (typeof key?.value === "string") return key.value;
  return null;
}

/** `<anything>.json({ error: ..., ... }, ...)` — first argument carries `error`. */
function isJsonErrorBodyCall(node: unknown): boolean {
  const call = toRecord(node);
  if (!call || !isJsonCallee(toRecord(call.callee))) return false;
  const args = call.arguments;
  if (!Array.isArray(args)) return false;
  const body = toRecord(args[0]);
  if (body?.type !== "ObjectExpression" || !Array.isArray(body.properties)) {
    return false;
  }
  return body.properties.some((property) => {
    const record = toRecord(property);
    return record !== null && keyName(record) === "error";
  });
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow c.json({ error }) domain-failure bodies in API routes; throw a DomainError instead.",
    },
    schema: BASELINE_OPTION_SCHEMA,
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!ROUTES_PATTERN.test(filename) || isTestFile(filename)) return {};

    const ratchet = createRatchet(
      baselineInForce(context, LEGACY_BASELINE),
      filename,
    );
    return {
      CallExpression(node: unknown) {
        if (!isJsonErrorBodyCall(node)) return;
        if (!ratchet.exceeds()) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
