/**
 * Global handling of an expired session in the cloud web app (roadmap 2 F4,
 * review 3.5). A 401 from any query or mutation used to surface as that
 * screen's generic error, or be retried three times. Now:
 *
 * - a 401 is never retried (signing in is the only fix), and
 * - the first one shows a persistent "Sessão expirada" notice whose action goes
 *   to sign-in and back here (`?redirect=`). Navigation goes through the router,
 *   so the execution worksheet's unsaved-changes guard still offers to keep the
 *   readings as a local draft before leaving. Later 401s while the notice is up
 *   add nothing.
 *
 * The desktop is out of scope: it has its own session (desktop-auth) and the
 * sync reports `auth_required`.
 *
 * Pure: the toast and the navigation are injected.
 */

/** A response error the API answered with 401 (`CalibraApiError` or a raw shape). */
export function isUnauthenticatedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'status') === 401
  )
}

/** Retry rule for queries: never a 401, otherwise up to three attempts. */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  return !isUnauthenticatedError(error) && failureCount < 3
}

export type SessionExpiryDeps = {
  /** The current location (path + search), where sign-in should come back to. */
  currentLocation: () => string
  /** Shows the persistent notice; `onSignIn` is its action, `onDismiss` its close. */
  notify: (actions: { onSignIn: () => void; onDismiss: () => void }) => void
  /** Goes to sign-in through the router. */
  goToSignIn: (redirect: string) => void
}

/** The `onError` of the query and mutation caches. */
export function createSessionExpiryHandler(deps: SessionExpiryDeps) {
  let noticeShown = false
  return (error: unknown) => {
    if (!isUnauthenticatedError(error) || noticeShown) return
    noticeShown = true
    const location = deps.currentLocation()
    deps.notify({
      onSignIn: () => {
        noticeShown = false
        deps.goToSignIn(
          location.startsWith('/sign-in') ? '/dashboard' : location,
        )
      },
      onDismiss: () => {
        noticeShown = false
      },
    })
  }
}
