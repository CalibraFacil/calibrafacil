import { THEME_STORAGE_KEY } from "@calibra-facil/shared/client-storage-keys";

/**
 * Theme preference for the portal, stored under the key both apps share
 * (`THEME_STORAGE_KEY`). `index.html` runs a bootstrap script that reads the same
 * key before React hydrates (prevents a flash of the wrong theme); `theme.test.ts`
 * checks that script still reads it.
 */

export type Theme = "light" | "dark" | "system";

/** Narrows an arbitrary stored value to a valid theme, defaulting to system. */
export function resolveTheme(value: string | null): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return resolveTheme(localStorage.getItem(THEME_STORAGE_KEY));
}

function applyTheme(theme: Theme) {
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
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}
