/**
 * localStorage keys the lab app and the client portal agree on. Storage is per
 * origin, so each app reads and writes its own; the portal also writes the
 * lab's key when it sends a user across ("Ir para o laboratório"), which only
 * lands when both apps are served from the same origin.
 */

/** Active organization of the lab app (`apps/web`). */
export const DASHBOARD_ORG_KEY = "dashboard-active-org";

/** Active client organization of the portal (`apps/portal`). */
export const PORTAL_ORG_KEY = "portal-active-org";

/**
 * Theme preference (`light` | `dark` | `system`), one key for both apps. The
 * pre-hydration bootstrap scripts of `apps/web` (`theme-init.js`) and
 * `apps/portal` (`index.html`) read it as a literal, since they run before any
 * module loads; the portal's `theme.test.ts` fails if its script stops reading
 * this key.
 */
export const THEME_STORAGE_KEY = "theme";
