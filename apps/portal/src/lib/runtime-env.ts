import { runtimeEnv } from "@calibra-facil/shared/runtime-env";

/**
 * The lab app's URL, for links from the portal back to it: VITE_WEB_URL, or
 * by convention the portal's own domain without the "portal." prefix.
 */
export function getWebAppUrl(): string {
  const configured = runtimeEnv("VITE_WEB_URL", import.meta.env.VITE_WEB_URL);
  if (configured) return configured;

  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:5173`;
  }
  return `${window.location.protocol}//${host.replace(/^portal\./, "")}`;
}
