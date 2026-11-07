import { redirect } from '@tanstack/react-router'

import { hasRuntimeSession } from '@/app/session/runtime-session'
import { setStoredDashboardOrganizationId } from '@/lib/dashboard-scope-storage'
import { readLabHandoffOrganizationId } from '@calibra-facil/shared/lab-handoff'

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

  if (!(await hasRuntimeSession())) {
    throw redirect({
      to: '/sign-in',
      search: { redirect: continuationHref(location) },
    })
  }

  adoptHandoffOrganization(location)
}

/**
 * The portal's "Ir para o laboratório" link names the laboratory to open
 * (`/dashboard?organization=<id>`): its localStorage is not ours, so the choice
 * is stored here and the param dropped. An id the user does not belong to is
 * ignored by the bootstrap, which only prefers a stored laboratory it can see.
 */
function adoptHandoffOrganization(location: {
  pathname: string
  searchStr?: string
}) {
  if (location.pathname !== '/dashboard' && location.pathname !== '/dashboard/')
    return

  const organizationId = readLabHandoffOrganizationId(location.searchStr)
  if (!organizationId) return

  setStoredDashboardOrganizationId(organizationId)
  throw redirect({ to: '/dashboard', replace: true })
}
