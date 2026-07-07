import {
  createRatchet,
  importSourceOf,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// Raw Hono RPC (`hc<AppType>` from "hono/client") and its transport helpers
// live inside packages/client-runtime only; packages/contracts may reference
// the client types to define AppType. Everything else calls the product-level
// SDK. Keeps the wire format swappable and the RPC surface auditable in one
// place (docs/architecture/api-client-contract.md).

const ALLOWED_PATTERN = /(^|\/)packages\/(client-runtime|contracts)\//;

// No known violations today — pure prevention (see the ratchet note in
// no-api-import-in-frontend.ts).
const LEGACY_BASELINE: Baseline = new Map<string, number>([]);

const MESSAGE =
  'Raw Hono RPC ("hono/client") is only allowed inside packages/client-runtime (and type-level use in packages/contracts). Call product-level methods on @calibra-facil/client-runtime instead.';

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Restrict "hono/client" imports to packages/client-runtime and packages/contracts.',
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (ALLOWED_PATTERN.test(filename)) return {};

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    const check = (node: unknown) => {
      const source = importSourceOf(node);
      if (source !== "hono/client" && !source?.startsWith("hono/client/")) {
        return;
      }
      if (!ratchet.exceeds()) return;
      context.report({ node, message: MESSAGE });
    };

    return {
      ImportDeclaration: check,
      ImportExpression: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

export default rule;
