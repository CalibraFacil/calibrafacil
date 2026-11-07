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
