import {
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// An error response RETURNED from inside a transaction callback commits the
// transaction: `return c.json({ error }, 400)` is a normal return, so every write
// made before it in the same callback is kept (roadmap 2 D4, review 3.2: the
// `assign-training` route linked half of the training records and answered 400).
// Throw a DomainError instead (apps/api/src/lib/domain-errors.ts): the throw
// rolls the transaction back and the error handler maps it to the same body.
//
// Flagged: `<x>.json(..., <status >= 400>)` or `<x>.body(..., <status >= 400>)`
// anywhere inside a function passed to `<db>.transaction(...)`,
// `orgTransactionWithExecutor(...)` or `inOrgTransaction(...)` in apps/api/src.
// Legacy sites (most return before any write, so commit nothing) are grandfathered
// as exact per-file counts; a file may never gain one.

const API_SRC_PATTERN = /(^|\/)apps\/api\/src\//;

const TRANSACTION_FUNCTIONS = new Set([
  "orgTransactionWithExecutor",
  "inOrgTransaction",
]);

const LEGACY_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/routes/accredited-scope.ts", 2],
  ["apps/api/src/routes/assets.ts", 19],
  ["apps/api/src/routes/authorized-signatories.ts", 2],
  ["apps/api/src/routes/capa.ts", 20],
  ["apps/api/src/routes/competences.ts", 22],
  ["apps/api/src/routes/customer-groups.ts", 4],
  ["apps/api/src/routes/customers.ts", 3],
  ["apps/api/src/routes/dashboard.ts", 1],
  ["apps/api/src/routes/materials.ts", 1],
  ["apps/api/src/routes/methods.ts", 61],
  ["apps/api/src/routes/non-conformances.ts", 36],
  ["apps/api/src/routes/portal-requests.ts", 1],
  ["apps/api/src/routes/portal.ts", 13],
  ["apps/api/src/routes/proficiency-tests.ts", 10],
  ["apps/api/src/routes/reports.ts", 8],
  ["apps/api/src/routes/services.ts", 15],
  ["apps/api/src/routes/signing.ts", 9],
  ["apps/api/src/routes/spc.ts", 13],
  ["apps/api/src/routes/standards.ts", 24],
  ["apps/api/src/routes/training-records.ts", 8],
  ["apps/api/src/routes/units.ts", 7],
  ["apps/api/src/routes/visits.ts", 26],
]);

const MESSAGE =
  "Do not return an error response from inside a transaction callback: the return commits every write made before it. Throw a DomainError (apps/api/src/lib/domain-errors.ts) so the transaction rolls back.";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

/** `<x>.json(…, status)` / `<x>.body(…, status)` with a literal status >= 400. */
function isErrorResponseCall(call: UnknownRecord): boolean {
  const callee = toRecord(call.callee);
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  const name = toRecord(callee.property)?.name;
  if (name !== "json" && name !== "body") return false;
  const args = call.arguments;
  if (!Array.isArray(args) || args.length < 2) return false;
  const status = toRecord(args[1]);
  return (
    status?.type === "Literal" &&
    typeof status.value === "number" &&
    status.value >= 400
  );
}

function isTransactionCall(call: UnknownRecord): boolean {
  const callee = toRecord(call.callee);
  if (callee?.type === "Identifier") {
    return (
      typeof callee.name === "string" && TRANSACTION_FUNCTIONS.has(callee.name)
    );
  }
  return (
    callee?.type === "MemberExpression" &&
    callee.computed !== true &&
    toRecord(callee.property)?.name === "transaction"
  );
}

function isFunction(node: UnknownRecord): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression"
  );
}

/** Whether `node` sits inside a function passed as an argument to a transaction call. */
function insideTransactionCallback(node: UnknownRecord): boolean {
  let current: UnknownRecord | null = node;
  while (current) {
    const parent = toRecord(current.parent);
    if (
      parent &&
      isFunction(current) &&
      parent.type === "CallExpression" &&
      Array.isArray(parent.arguments) &&
      parent.arguments.includes(current) &&
      isTransactionCall(parent)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow returning an error response from inside a transaction callback (it commits partial writes); throw a DomainError.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!API_SRC_PATTERN.test(filename) || isTestFile(filename)) return {};

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    return {
      CallExpression(node: unknown) {
        const call = toRecord(node);
        if (!call || !isErrorResponseCall(call)) return;
        if (!insideTransactionCallback(call)) return;
        if (!ratchet.exceeds()) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
