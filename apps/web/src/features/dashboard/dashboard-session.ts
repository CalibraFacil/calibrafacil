import { redirect } from '@tanstack/react-router'

import { hasRuntimeSession } from '@/app/session/runtime-session'

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
}
