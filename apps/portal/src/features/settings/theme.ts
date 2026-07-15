/**
 * Theme preference for the portal. The `theme` localStorage key is shared with
 * the web app, and `index.html` runs a bootstrap script that reads the same key
 * before React hydrates (prevents a flash of the wrong theme). Keep the three
 * pieces in sync: this module, the bootstrap script, and the web app.
 */

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "theme";

/** Narrows an arbitrary stored value to a valid theme, defaulting to system. */
export function resolveTheme(value: string | null): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return resolveTheme(localStorage.getItem(THEME_KEY));
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "system") {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    root.classList.add(systemTheme);
  } else {
    root.classList.add(theme);
  }
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
