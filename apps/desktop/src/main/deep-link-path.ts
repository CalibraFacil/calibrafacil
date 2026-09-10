/**
 * The one predicate that enforces the deep-link output invariant.
 *
 * Split into its own module so the checks can be read as text. An earlier
 * version put the control-character range in a regex, which meant either
 * literal control bytes in the source (invisible in a diff) or a lint
 * suppression; an explicit code-point scan needs neither.
 *
 * The WHATWG URL parser already covers much of this — it resolves `..`
 * segments and throws outright on `calibrafacil://javascript:alert(1)`. But
 * "the current parser happens to handle it" is not a security property to
 * rely on across Node and Electron upgrades, so the invariant is checked
 * directly.
 *
 * Apply to the **decoded** path, so `%2e%2e%2f` cannot smuggle a traversal
 * past a check that only inspected the raw form.
 */

/** Protocol-relative: a renderer would follow `//host/x` to another origin. */
const PROTOCOL_RELATIVE = /^\/\//;

/** Any scheme prefix — `javascript:`, `data:`, `file:`. */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

const TRAVERSAL = /\.\./;

export function isUnsafeDeepLinkPath(decodedPath: string) {
  return (
    PROTOCOL_RELATIVE.test(decodedPath) ||
    SCHEME_PREFIX.test(decodedPath) ||
    TRAVERSAL.test(decodedPath) ||
    hasControlCharacter(decodedPath)
  );
}

/**
 * C0 controls and DEL. A space is deliberately allowed — it is harmless in a
 * route path and rejecting it would break legitimate percent-encoded ids.
 */
export function hasControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }

  return false;
}
