import { createContext, useContext } from "react";

/**
 * The id a composable Field gives its control (roadmap 2 F4, review 3.5): a
 * text `FieldLabel` points at it and `Input`, `Textarea`, `NativeSelect` and
 * `SelectTrigger` take it when they carry no id of their own, so the label is
 * associated without wiring `htmlFor`/`id` by hand. An explicit `htmlFor` or
 * `id` always wins.
 *
 * Its own module (no markup, no classes) so a control can read it without
 * importing the Field component and its styles.
 */
export const FieldControlIdContext = createContext<string | undefined>(
  undefined,
);

/** The id of the enclosing Field's control, for a control that has none. */
export function useFieldControlId(): string | undefined {
  return useContext(FieldControlIdContext);
}
