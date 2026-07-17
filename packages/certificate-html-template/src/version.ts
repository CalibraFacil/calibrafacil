/**
 * Compiler version for the `wysiwyg` certificate engine.
 *
 * Recorded in `renderPolicy.compilerVersion` on every preview and issued
 * certificate. Bump on ANY change that can alter compiled HTML for the same
 * (documentJson, inputData) pair — block renderers, print CSS, formatters,
 * serialization order. Same discipline as `ENGINE_VERSION` in
 * `packages/math-engine`.
 */
export const CERT_HTML_COMPILER_VERSION = "0.5.0";
