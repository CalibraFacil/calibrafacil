/**
 * The status vocabulary shared by the lab app and the client portal.
 *
 * Every status in the product is one of five tones. `STATUS_TONE` maps a tone
 * to the Tailwind utility classes that paint it, so a status never reaches for
 * a raw palette colour:
 *
 * | Tone       | Meaning                        | Colour                  |
 * | :--------- | :----------------------------- | :---------------------- |
 * | `ok`       | scheduled / healthy / released | `signal-ok` token       |
 * | `critical` | overdue / breached / rejected  | `destructive` token     |
 * | `warning`  | due soon / attention           | `signal-warning` token  |
 * | `info`     | in progress / informational    | `primary` token         |
 * | `neutral`  | unscheduled / inert            | `muted` token           |
 *
 * Every class below resolves to a CSS variable, never a fixed colour, so each
 * app re-themes the vocabulary by overriding variables (`--primary`,
 * `--destructive`, and the `--signal-*` tokens in `tokens.css`). The classes
 * are literal strings on purpose: Tailwind finds them by scanning this file
 * (`tokens.css` registers the package as a source).
 */

export type SignalTone = "ok" | "critical" | "warning" | "info" | "neutral";

export const SIGNAL_TONES = [
  "ok",
  "critical",
  "warning",
  "info",
  "neutral",
] as const satisfies readonly SignalTone[];

export type StatusToneClasses = {
  /** Filled pill / chip: tinted background plus readable text. */
  surface: string;
  /** Same as `surface`; kept for timeline-style "soft" markers. */
  soft: string;
  /** Text colour only. */
  text: string;
  /** Solid indicator dot. */
  dot: string;
  /** Tinted background for a metric tile (no text colour). */
  tile: string;
  /** Large numeric value inside a tile. */
  value: string;
  /** Icon glyph. */
  icon: string;
  /** Bordered, tinted callout (alert) with the leading icon coloured. */
  alert: string;
};

export const STATUS_TONE: Record<SignalTone, StatusToneClasses> = {
  ok: {
    surface: "bg-signal-ok/10 text-signal-ok-text",
    soft: "bg-signal-ok/10 text-signal-ok-text",
    text: "text-signal-ok-text",
    dot: "bg-signal-ok-dot",
    tile: "bg-signal-ok/10",
    value: "text-signal-ok-text",
    icon: "text-signal-ok-icon",
    alert:
      "border-signal-ok/30 bg-signal-ok/10 text-foreground [&>svg]:text-signal-ok-icon",
  },
  critical: {
    surface: "bg-destructive/10 text-destructive",
    soft: "bg-destructive/10 text-destructive",
    text: "text-destructive",
    dot: "bg-destructive",
    tile: "bg-destructive/10",
    value: "text-destructive",
    icon: "text-destructive",
    alert:
      "border-destructive/30 bg-destructive/10 text-foreground [&>svg]:text-destructive",
  },
  warning: {
    surface: "bg-signal-warning/10 text-signal-warning-text",
    soft: "bg-signal-warning/10 text-signal-warning-text",
    text: "text-signal-warning-text",
    dot: "bg-signal-warning-dot",
    tile: "bg-signal-warning/10",
    value: "text-signal-warning-text",
    icon: "text-signal-warning-icon",
    alert:
      "border-signal-warning/40 bg-signal-warning/10 text-foreground [&>svg]:text-signal-warning-icon",
  },
  info: {
    surface: "bg-primary/10 text-primary",
    soft: "bg-primary/10 text-primary",
    text: "text-primary",
    dot: "bg-primary",
    tile: "bg-primary/10",
    value: "text-primary",
    icon: "text-primary",
    alert:
      "border-primary/30 bg-primary/10 text-foreground [&>svg]:text-primary",
  },
  neutral: {
    surface: "bg-muted text-muted-foreground",
    soft: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
    tile: "bg-muted/45",
    value: "text-foreground",
    icon: "text-muted-foreground",
    alert:
      "border-border bg-card text-card-foreground [&>svg]:text-muted-foreground",
  },
};
