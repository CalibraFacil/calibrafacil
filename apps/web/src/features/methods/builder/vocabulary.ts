/**
 * The member of a closed list (the vocabularies in `@calibra-facil/shared`
 * `method-model.ts`) that a select reports as a string, or the fallback. The
 * list is the only place a value is added, so a select cannot refuse one.
 */
export function pickOption<T extends string>(
  options: ReadonlyArray<T>,
  value: string | null,
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback
}
