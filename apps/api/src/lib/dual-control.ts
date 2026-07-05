// Dual-control (maker-checker) identity rule — the single source of truth.
//
// The backoffice approval queue enforces separation of duties over sensitive,
// money-touching actions: the person who DECIDES (approves/rejects) an
// `approval_request` must be a DIFFERENT natural person than the person they are
// compared against. Historically this rule lived inline in the
// `/approvals/:id/decide` route (backoffice.ts); DOM-04 (#657) also needs it at
// the point a financial action actually EXECUTES, so it is centralized here and
// reused in both places rather than re-implemented in parallel.

/**
 * Returns `true` when the two user identities are the SAME natural person — i.e.
 * dual-control is VIOLATED (the checker is also the maker/executor).
 *
 * Semantics preserve the original inline rule exactly: a strict `===` on two
 * defined ids. A `null`/`undefined` on EITHER side is treated as "cannot confirm
 * they are the same person" → returns `false` (not-same). At the decision route
 * this matches the original `existing.requestedByUserId === session.user.id`
 * behavior (the session id is never null). Callers that must FAIL CLOSED on a
 * missing identity (e.g. the financial-execution gate, where an approval with no
 * decider can never be trusted) MUST assert presence separately before relying
 * on this predicate.
 */
export function isSameDualControlIdentity(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return a != null && b != null && a === b;
}
