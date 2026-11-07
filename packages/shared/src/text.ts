/** Accent- and case-insensitive form of a pt-BR string, for search and matching. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** `foldText`, every run of other characters as one `-`, no leading/trailing `-`. */
export function slugify(
  value: string,
  maxLength = Number.POSITIVE_INFINITY,
): string {
  // Runs are collapsed first, so at most one `-` sits at either end: the trims
  // below need no quantifier (linear time on any input).
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/, "");
}
