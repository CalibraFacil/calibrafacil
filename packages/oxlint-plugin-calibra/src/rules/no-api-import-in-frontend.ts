import {
  importSourceOf,
  normalizedFilename,
  resolveRelativeImport,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// The repo's most important boundary (docs/architecture/api-client-contract.md):
// frontend code must never pull server runtime into its type graph. Until now
// this rode on package.json structure + manual `rg` scans; this rule makes it
// deterministic in `pnpm lint`.

const FRONTEND_PATTERN = /(^|\/)apps\/(web|portal)\//;

function isApiImport(filename: string, source: string): boolean {
  if (
    source === "@calibra-facil/api" ||
    source.startsWith("@calibra-facil/api/")
  ) {
    return true;
  }
  const resolved = resolveRelativeImport(filename, source);
  return resolved !== null && /(^|\/)apps\/api\//.test(resolved);
}

const MESSAGE =
  "Frontend code must never import @calibra-facil/api or apps/api/* — call product-level methods on @calibra-facil/client-runtime (or DTOs from @calibra-facil/contracts) instead. See docs/architecture/api-client-contract.md.";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing the server package (@calibra-facil/api / apps/api/*) from frontend apps.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!FRONTEND_PATTERN.test(filename)) return {};

    const check = (node: unknown) => {
      const source = importSourceOf(node);
      if (source === null || !isApiImport(filename, source)) return;
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
