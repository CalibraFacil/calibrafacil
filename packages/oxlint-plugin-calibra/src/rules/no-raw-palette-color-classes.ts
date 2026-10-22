import {
  baselineFor,
  isTestFile,
  normalizedFilename,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";
import { countRawPaletteClasses, FEATURES_PATTERN } from "../lib/palette.ts";
import { PALETTE_BASELINE } from "../lib/palette-baseline.ts";

// Ratchet on raw Tailwind palette colours in feature code. Status is one
// vocabulary, SignalTone (ok / critical / warning / info / neutral), and its
// classes live in @calibra-facil/ui/status-tone as theme-token utilities, so a
// screen re-themes with the app instead of carrying its own `text-red-500`.
//
// The files that still hard-code a palette step are grandfathered with their
// exact count in lib/palette-baseline.ts (regenerate with
// `pnpm --filter @calibra-facil/oxlint-plugin-calibra baseline:palette` after
// migrating a file; the baseline test fails when a count is stale in either
// direction). A file may never gain one, and a file not in the baseline has
// none to spend. Applies to apps/web and apps/portal `src/features`, tests
// exempt.

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ratchet: no new raw Tailwind palette colour classes (text-red-500, bg-emerald-600/10, ...) in apps/*/src/features — use status-tone / theme tokens.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!FEATURES_PATTERN.test(filename) || isTestFile(filename)) return {};

    const allowed = baselineFor(PALETTE_BASELINE, filename);

    return {
      Program(node: unknown) {
        const found = countRawPaletteClasses(context.sourceCode.text);
        if (found <= allowed) return;
        context.report({
          node,
          message: `${found} raw Tailwind palette colour classes (text-red-500, bg-emerald-600/10, ...) but this file is allowed ${allowed}. Status colour comes from the shared vocabulary: use STATUS_TONE[tone] from @calibra-facil/ui/status-tone, or a theme token (text-destructive, bg-primary/10, text-muted-foreground), instead of a palette step.`,
        });
      },
    };
  },
};

export default rule;
