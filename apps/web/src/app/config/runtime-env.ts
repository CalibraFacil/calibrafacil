declare global {
  interface Window {
    /** Settings a prebuilt image receives at startup: see public/runtime-env.js. */
    calibraRuntimeEnv?: Record<string, unknown>
  }
}

/**
 * A `VITE_*` setting, read when the page loads rather than only at build time.
 *
 * The Docker image's static server answers `/runtime-env.js` with the
 * container's `VITE_*` variables, so one prebuilt image works for any domain.
 * Elsewhere that file is an empty default and the value baked in at build time
 * (`buildTimeValue`, always an `import.meta.env.VITE_*` read) applies.
 */
export function runtimeEnv(
  name: string,
  buildTimeValue: string | undefined,
): string | undefined {
  const value =
    typeof window === 'undefined' ? undefined : window.calibraRuntimeEnv?.[name]
  return typeof value === 'string' && value.trim() ? value : buildTimeValue
}
