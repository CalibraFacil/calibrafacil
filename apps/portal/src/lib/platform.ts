/**
 * OS-aware keyboard-shortcut labels. The handlers accept both Cmd and Ctrl
 * (metaKey || ctrlKey); these helpers make the *displayed* hint match the
 * platform — "⌘" on macOS, "Ctrl" everywhere else.
 */
export const isMacOS =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Display label for the primary modifier key. */
export const MOD_KEY = isMacOS ? "⌘" : "Ctrl";

/** A shortcut label, e.g. "⌘K" on macOS or "Ctrl K" elsewhere. */
export function shortcutLabel(key: string): string {
  return isMacOS ? `${MOD_KEY}${key}` : `${MOD_KEY} ${key}`;
}
