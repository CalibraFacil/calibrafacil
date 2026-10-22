/**
 * The instrument-panel surface and action-button classes, kept apart from
 * `instrument-panel.tsx` (which pulls in `motion` and the tooltip stack) so
 * code that must stay out of the initial bundle graph, like the router-level
 * boundaries, can wear the same look without importing it.
 */

/** Flat console surface — concentric-radius safe (rounded-2xl outer). */
export const PANEL_CLASS =
  "min-w-0 rounded-2xl bg-card text-card-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--ink)_5%,transparent),0_16px_40px_color-mix(in_oklab,var(--ink)_5%,transparent)] ring-1 ring-foreground/10";

/** Tactile press + property-specific transition (never `transition: all`). */
export const ACTION_BUTTON_CLASS =
  "min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]";
