/**
 * Settings a prebuilt frontend image receives at startup (lab app and portal).
 *
 * The Docker image's static server (`scripts/static-server.ts`) answers
 * `/runtime-env.js` with `window.calibraRuntimeEnv = { VITE_*: ... }`, the
 * container's `VITE_*` variables, so one image works for any domain. The
 * frontends read a setting through `runtimeEnv` below. The server cannot import
 * this module (it is copied into the image alone), so `runtime-env.spec.ts`
 * holds its literals to these constants.
 */

/** The `window` property `/runtime-env.js` fills in. */
export const RUNTIME_ENV_GLOBAL = "calibraRuntimeEnv";

/** Only variables with this prefix are served to the browser. */
export const RUNTIME_ENV_PREFIX = "VITE_";

/**
 * A `VITE_*` setting, read when the page loads rather than only at build time:
 * the value the container served, else `buildTimeValue` (always an
 * `import.meta.env.VITE_*` read) when it is unset, blank or not a string, or
 * when there is no browser.
 */
export function runtimeEnv(
  name: string,
  buildTimeValue: string | undefined,
): string | undefined {
  const host: unknown = Reflect.get(globalThis, "window");
  const served: unknown =
    typeof host === "object" && host !== null
      ? Reflect.get(host, RUNTIME_ENV_GLOBAL)
      : undefined;
  const value: unknown =
    typeof served === "object" && served !== null
      ? Reflect.get(served, name)
      : undefined;

  return typeof value === "string" && value.trim() ? value : buildTimeValue;
}
