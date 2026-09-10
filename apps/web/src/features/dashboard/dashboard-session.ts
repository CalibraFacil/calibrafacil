import { redirect } from '@tanstack/react-router'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
import { authClient } from '@calibra-facil/auth/client'

import { getBackofficeAppUrl } from '@/app/config/runtime'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'
import { getClientSession, readSessionWithRetry } from '@/lib/auth-session'

// Inference through readSessionWithRetry's naked type parameter widens
// TSession to `{}`, so name it explicitly off the auth client.
type DashboardSession = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>['data']
>

/**
 * Where to send the user back to after signing in.
 *
 * The pathname alone loses the filter and anchor a deep link carried — a link
 * to `/dashboard/jobs?status=REVIEW#top` would land on an unfiltered list,
 * silently discarding what `resolveDeepLink` went to trouble to preserve.
 */
function continuationHref(location: {
  pathname: string
  searchStr?: string
  hash?: string
}) {
  const search = location.searchStr ?? ''
  const hash = location.hash ?? ''
  const normalizedSearch =
    search && !search.startsWith('?') ? `?${search}` : search
  const normalizedHash = hash && !hash.startsWith('#') ? `#${hash}` : hash

  return `${location.pathname}${normalizedSearch}${normalizedHash}`
}

export async function dashboardBeforeLoad({
  location,
  preload,
}: {
  location: { pathname: string; searchStr?: string; hash?: string }
  preload?: boolean
}) {
  if (preload) return

  if (isDesktopRuntime()) {
    if (await hasDesktopSession()) return

    throw redirect({
      to: '/sign-in',
      search: { redirect: continuationHref(location) },
    })
  }

  const { data: session } =
    await readSessionWithRetry<DashboardSession>(getClientSession)

  if (!session) {
    throw redirect({
      to: '/sign-in',
      search: { redirect: continuationHref(location) },
    })
  }

  if (
    canAccessBackoffice(session.user.role) &&
    !session.session.impersonatedBy &&
    !isDesktopRuntime() &&
    typeof window !== 'undefined'
  ) {
    // The backoffice is a separate cross-origin app now. Kick off the
    // navigation, then block beforeLoad indefinitely so TanStack Router does
    // not mount the dashboard route or run child loaders while the browser
    // completes the cross-origin redirect (a bare return would let lab code
    // render for a beat first).
    window.location.replace(getBackofficeAppUrl())
    await new Promise<never>(() => {})
  }
}
