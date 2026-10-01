import {
  createRatchet,
  importSourceOf,
  normalizedFilename,
  resolveRelativeImport,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// The repo's most important boundary (docs/architecture/api-client-contract.md):
// frontend code must never pull server runtime into its type graph. Until now
// this rode on package.json structure + manual `rg` scans; this rule makes it
// deterministic in `pnpm lint`.

const FRONTEND_PATTERN = /(^|\/)apps\/(web|portal)\//;

// No known violations today — this rule is pure prevention. If a violation
// must ever be grandfathered, add "<repo-relative path>": <count> here; new
// occurrences beyond the listed count still fail (baseline ratchet).
const LEGACY_BASELINE: Baseline = new Map<string, number>([]);

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

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    const check = (node: unknown) => {
      const source = importSourceOf(node);
      if (source === null || !isApiImport(filename, source)) return;
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
