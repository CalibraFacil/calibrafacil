import {
  createRatchet,
  importedNamesOf,
  importSourceOf,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// Feature-first frontend rule (docs/architecture/web-frontend-architecture.md):
// apps/web/src/features/** holds the implementation; the thin adapters in
// apps/web/src/routes/** own createFileRoute and read params/search, passing
// them to features as props. A feature that reaches for createFileRoute /
// useParams / useSearch couples product UI to the router and breaks that
// contract. Link/useNavigate/etc. remain allowed. Test files are exempt —
// route-adapter tests legitimately build a real router.

const FEATURES_PATTERN = /(^|\/)apps\/web\/src\/features\//;
const ROUTER_MODULE = "@tanstack/react-router";
const BANNED_IMPORTS = new Set(["createFileRoute", "useParams", "useSearch"]);

// No known violations today — pure prevention (see the ratchet note in
// no-api-import-in-frontend.ts).
const LEGACY_BASELINE: Baseline = new Map<string, number>([]);

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow createFileRoute/useParams/useSearch imports inside apps/web/src/features — route adapters pass params/search in as props.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!FEATURES_PATTERN.test(filename) || isTestFile(filename)) return {};

    const ratchet = createRatchet(LEGACY_BASELINE, filename);

    return {
      ImportDeclaration(node: unknown) {
        if (importSourceOf(node) !== ROUTER_MODULE) return;
        const banned = importedNamesOf(node).filter((name) =>
          BANNED_IMPORTS.has(name),
        );
        for (const name of banned) {
          if (!ratchet.exceeds()) continue;
          context.report({
            node,
            message: `Feature modules must not import ${name} from ${ROUTER_MODULE} — the route adapter in apps/web/src/routes owns router coupling and passes params/search as props (docs/architecture/web-frontend-architecture.md).`,
          });
        }
      },
    };
  },
};

export default rule;
