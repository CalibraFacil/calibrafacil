/** Accent- and case-insensitive form of a pt-BR string, for search and matching. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** `foldText`, every run of other characters as one `-`, no leading/trailing `-`. */
export function slugify(
  value: string,
  maxLength = Number.POSITIVE_INFINITY,
): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}
