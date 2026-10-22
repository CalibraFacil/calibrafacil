import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  importSourceOf,
  normalizedFilename,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// The shadcn/base-ui primitives live in ONE place, packages/ui, and both
// frontends import them from `@calibra-facil/ui/<name>`. Before the package,
// apps/web and apps/portal each carried their own `components/ui/*` copy and
// the copies drifted (34 of 36 shared files differed). Two guards keep that
// from coming back:
//
//   1. a file `apps/<app>/src/components/ui/<name>.tsx` whose <name> is a
//      package component is a re-creation: fix the package instead;
//   2. an import of `@/components/ui/<name>` for such a name is a stale path.
//
// Components only one app renders (web's currency-input, timeline, ...) may
// stay in that app's components/ui: only names the package owns are flagged.
// The list is read from packages/ui/src/components, so it cannot go stale.

const APP_UI_FILE = /(^|\/)apps\/[^/]+\/src\/components\/ui\/([^/]+)\.tsx?$/;
const APP_UI_IMPORT = /^@\/components\/ui\/([^/]+)$/;

const COMPONENTS_DIR = new URL("../../../ui/src/components/", import.meta.url);

function packageComponentNames(): ReadonlySet<string> {
  try {
    return new Set(
      readdirSync(fileURLToPath(COMPONENTS_DIR))
        .filter((entry) => entry.endsWith(".tsx") && !entry.includes(".test."))
        .map((entry) => entry.slice(0, -".tsx".length)),
    );
  } catch {
    // Fixture trees without the package: nothing to protect.
    return new Set();
  }
}

const OWNED = packageComponentNames();

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow app-local components/ui re-creations of @calibra-facil/ui components and imports of their old app-local paths.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);

    return {
      Program(node: unknown) {
        const name = APP_UI_FILE.exec(filename)?.[2];
        if (name === undefined || !OWNED.has(name)) return;
        context.report({
          node,
          message: `components/ui/${name} re-creates a @calibra-facil/ui component. Import it from "@calibra-facil/ui/${name}" and change packages/ui/src/components/${name}.tsx if it needs to behave differently.`,
        });
      },
      ImportDeclaration(node: unknown) {
        const source = importSourceOf(node);
        const name =
          source === null ? undefined : APP_UI_IMPORT.exec(source)?.[1];
        if (name === undefined || !OWNED.has(name)) return;
        context.report({
          node,
          message: `"@/components/ui/${name}" is not where ${name} lives any more. Import it from "@calibra-facil/ui/${name}".`,
        });
      },
    };
  },
};

export default rule;
