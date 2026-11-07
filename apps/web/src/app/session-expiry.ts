/**
 * Global handling of an expired session in the cloud web app: a 401 from any
 * query or mutation is not that screen's generic error, nor retried three times.
 *
 * - a 401 is never retried (signing in is the only fix), and
 * - the first one shows a persistent "Sessão expirada" notice whose action goes
 *   to sign-in and back here (`?redirect=`). Navigation goes through the router,
 *   so the execution worksheet's unsaved-changes guard still offers to keep the
 *   readings as a local draft before leaving. Later 401s while the notice is up
 *   add nothing.
 *
 * The desktop follows the same rule. Its 401s come from the cloud (a cloud-only
 * screen, or the session behind the sync, which also shows `auth_required` in
 * the data-source indicator), so the way back in is the same sign-in page; the
 * only difference is that a desktop with an offline snapshot would bounce
 * `/sign-in` straight back to the dashboard (`hasDesktopSession`), so the
 * action first marks the desktop signed out (`prepareSignIn`). That keeps the
 * local database and the queued changes: it is not a sign-out, nothing is
 * forgotten, and offline work keeps going until the person chooses to sign in.
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
  /** Runs when the person chooses to sign in, just before `goToSignIn`. */
  prepareSignIn?: () => void
}

/** The text of the notice; the desktop also says what happens to local work. */
export function sessionExpiredDescription(isDesktop: boolean) {
  return isDesktop
    ? 'Entre novamente para continuar e sincronizar. Leituras não salvas podem ser mantidas como rascunho e as alterações locais continuam guardadas.'
    : 'Entre novamente para continuar. Leituras não salvas podem ser mantidas como rascunho.'
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
        deps.prepareSignIn?.()
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
