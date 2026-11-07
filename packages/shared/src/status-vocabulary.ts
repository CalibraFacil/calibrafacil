/**
 * A status vocabulary: the states of one lifecycle with the pt-BR label and the tone every surface
 * (lab app, portal, e-mail, PDF) shows for each. Declared once, where the states are declared, so a
 * new state cannot reach a screen without its label and tone.
 */

/**
 * The five tones a status can take. `@calibra-facil/ui/status-tone` paints them.
 *
 * | Tone       | Meaning                        |
 * | :--------- | :----------------------------- |
 * | `ok`       | scheduled / healthy / released |
 * | `critical` | overdue / breached / rejected  |
 * | `warning`  | due soon / attention           |
 * | `info`     | in progress / informational    |
 * | `neutral`  | unscheduled / inert            |
 */
export type SignalTone = "ok" | "critical" | "warning" | "info" | "neutral";

export const SIGNAL_TONES = [
  "ok",
  "critical",
  "warning",
  "info",
  "neutral",
] as const satisfies readonly SignalTone[];

export type StatusPresentation = { label: string; tone: SignalTone };

export type StatusVocabulary<S extends string> = {
  readonly states: readonly S[];
  readonly presentation: Readonly<Record<S, StatusPresentation>>;
  label(state: S): string;
  tone(state: S): SignalTone;
  /** The state a raw value names, or null (URL params, select values, untyped rows). */
  parse(value: unknown): S | null;
  is(value: unknown): value is S;
  /**
   * The state a raw value names; an unknown one throws instead of becoming a
   * default state. For values the API already validated: a status this build
   * does not know is version skew, and it must show, not read as "draft".
   */
  require(value: unknown): S;
  /** `{ value, label }` per state, in declaration order (select and filter options). */
  readonly options: ReadonlyArray<{ value: S; label: string }>;
};

export function defineStatusVocabulary<S extends string>(
  states: readonly S[],
  presentation: Record<S, StatusPresentation>,
): StatusVocabulary<S> {
  const is = (value: unknown): value is S =>
    typeof value === "string" && states.some((state) => state === value);
  return {
    states,
    presentation,
    label: (state) => presentation[state].label,
    tone: (state) => presentation[state].tone,
    parse: (value) => (is(value) ? value : null),
    require: (value) => {
      if (is(value)) return value;
      throw new Error(`Unknown status: ${String(value)}`);
    },
    is,
    options: states.map((value) => ({
      value,
      label: presentation[value].label,
    })),
  };
}

/** Whether `value` is one of `states` (a subset such as "open" or "certificate issued"). */
export function isOneOf<S extends string>(
  states: readonly S[],
  value: unknown,
): value is S {
  return states.some((state) => state === value);
}
