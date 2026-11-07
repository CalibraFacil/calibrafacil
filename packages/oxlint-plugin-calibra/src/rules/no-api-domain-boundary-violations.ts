import {
  importSourceOf,
  isTestFile,
  normalizedFilename,
  resolveRelativeImport,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// API layering (docs/architecture/api-domains.md): apps/api/src/domains/<d>/ holds a
// domain's routes, commands, queries, cron work and notifications. Dependencies point down:
//
//   - lib/ and middleware/ (the cross-domain platform) never import a domain;
//   - everything else (another domain, server/, cron/, cli/, app.ts) reaches a domain only
//     through its public entry, domains/<d>/index.ts, never through a deep path.
//
// A domain imports its own files freely. Specs are exempt: a spec may reach into any module
// (vi.mock needs the real module id). The baseline is empty: there is no allowance.

const API_SRC = /(^|\/)apps\/api\/src\/(.*)$/;
const DOMAIN_PATH = /^domains\/([^/]+)(?:\/(.*))?$/;

const PLATFORM_MESSAGE =
  "lib/ and middleware/ are the platform layer: they must not import apps/api/src/domains/*. Move the shared piece down into the platform (or the platform file into the domain that owns it). See docs/architecture/api-domains.md.";
const DEEP_MESSAGE =
  "Import another domain only through its public entry (apps/api/src/domains/<domain>, i.e. its index.ts), not a deep path. Export the name from the target domain's index.ts. See docs/architecture/api-domains.md.";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Platform code must not import apps/api domains; other code reaches a domain only through domains/<d>/index.ts.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    const own = API_SRC.exec(filename);
    if (!own || isTestFile(filename)) return {};
    const ownPath = own[2] ?? "";
    const ownDomain = DOMAIN_PATH.exec(ownPath)?.[1] ?? null;
    const isPlatform = /^(lib|middleware)\//.test(ownPath);

    const check = (node: unknown) => {
      const source = importSourceOf(node);
      if (source === null) return;
      const resolved = resolveRelativeImport(filename, source);
      if (resolved === null) return;
      const target = API_SRC.exec(resolved)?.[2];
      if (target === undefined) return;
      const hit = DOMAIN_PATH.exec(target);
      if (!hit) return;
      const [, targetDomain, rest = ""] = hit;
      if (isPlatform) {
        context.report({ node, message: PLATFORM_MESSAGE });
        return;
      }
      if (targetDomain === ownDomain) return;
      if (rest === "" || rest === "index" || rest === "index.ts") return;
      context.report({ node, message: DEEP_MESSAGE });
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
