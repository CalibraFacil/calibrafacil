import {
  importSourceOf,
  normalizedFilename,
  resolveRelativeImport,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// Layering rule (docs/architecture/web-frontend-architecture.md): everything
// depends on what changes less. `apps/web/src/{components,lib,utils,hooks}` are
// the low layers: shared UI, helpers and hooks that every feature builds on.
// They must not import `apps/web/src/features/**`, or a feature edit ripples
// into the code every other feature depends on and the layers form a cycle.
// A piece of a feature that a low layer needs belongs in the low layer; a
// low-layer file that needs a feature belongs in that feature (or in the app
// shell, `features/dashboard`). The baseline is empty: there is no allowance.

const LOW_LAYER_PATTERN =
  /(^|\/)apps\/web\/src\/(components|lib|utils|hooks)\//;
const FEATURES_ALIAS = /^@\/features(\/|$)/;
const FEATURES_PATH = /(^|\/)apps\/web\/src\/features(\/|$)/;

function isFeatureImport(filename: string, source: string): boolean {
  if (FEATURES_ALIAS.test(source)) return true;
  const resolved = resolveRelativeImport(filename, source);
  return resolved !== null && FEATURES_PATH.test(resolved);
}

const MESSAGE =
  "apps/web/src/{components,lib,utils,hooks} must not import features/* — low layers depend on nothing above them. Move the shared piece down into the low layer (or the feature-specific file into its feature) instead. See docs/architecture/web-frontend-architecture.md.";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow apps/web/src/{components,lib,utils,hooks} from importing apps/web/src/features/**.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!LOW_LAYER_PATTERN.test(filename)) return {};

    const check = (node: unknown) => {
      const source = importSourceOf(node);
      if (source === null || !isFeatureImport(filename, source)) return;
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
