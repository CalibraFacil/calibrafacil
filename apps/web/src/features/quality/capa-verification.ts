/**
 * CAPA verification independence (decision Q50).
 *
 * The API refuses a verifier tied to the CAPA (its owner now or ever, or whoever
 * implemented it) with 403 `self_approval_blocked`. When that person is also the
 * laboratory's only eligible verifier, the refusal carries
 * `details.independence_waiver_available: true`: they may resend the verification
 * with a written justification.
 */
export function isIndependenceWaiverOffered(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const payload: unknown = Reflect.get(error, 'payload')
  if (typeof payload !== 'object' || payload === null) return false
  if (Reflect.get(payload, 'code') !== 'self_approval_blocked') return false
  const details: unknown = Reflect.get(payload, 'details')
  return (
    typeof details === 'object' &&
    details !== null &&
    Reflect.get(details, 'independence_waiver_available') === true
  )
}
