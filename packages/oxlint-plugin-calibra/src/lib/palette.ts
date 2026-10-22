// Raw Tailwind palette colour utilities (`text-red-500`, `bg-emerald-600/10`,
// `dark:border-amber-400`, ...). Shared by the rule and by the script that
// writes its baseline, so both count exactly the same thing.
//
// Status colour belongs to the SignalTone vocabulary
// (`STATUS_TONE` in @calibra-facil/ui/status-tone), which resolves to theme
// tokens; a hard-coded palette step cannot be re-themed and drifts from the
// vocabulary the rest of the product speaks.

const PALETTE_NAMES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";

// The lookbehind keeps `context-red-500` and `--text-red-500` out; a variant
// prefix (`dark:`, `hover:`) or a quote/space/bracket before the utility is fine.
const RAW_PALETTE_CLASS = new RegExp(
  `(?<![A-Za-z0-9_-])(?:text|bg|border|ring)-(?:${PALETTE_NAMES})-\\d{2,3}(?![A-Za-z0-9_])`,
  "g",
);

/** How many raw palette colour utilities the source text contains. */
export function countRawPaletteClasses(sourceText: string): number {
  return sourceText.match(RAW_PALETTE_CLASS)?.length ?? 0;
}

/** Feature code of the two frontends: where the ratchet applies. */
export const FEATURES_PATTERN = /(^|\/)apps\/(web|portal)\/src\/features\//;
