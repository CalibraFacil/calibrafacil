import { redirect } from '@tanstack/react-router'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
import { authClient } from '@calibra-facil/auth/client'

import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

const DASHBOARD_SESSION_CACHE_MS = 30_000

type DashboardSessionResult = Awaited<ReturnType<typeof authClient.getSession>>

let dashboardSessionPromise: ReturnType<typeof authClient.getSession> | null =
  null
let dashboardSessionCache: {
  expiresAt: number
  result: DashboardSessionResult
} | null = null

export async function dashboardBeforeLoad({
  location,
  preload,
}: {
  location: { pathname: string }
  preload?: boolean
}) {
  if (preload) return

  if (isDesktopRuntime()) {
    if (await hasDesktopSession()) return

    throw redirect({
      to: '/sign-in',
      search: { redirect: location.pathname },
    })
  }

  const { data: session } = await getDashboardSession()

  if (!session) {
    throw redirect({
      to: '/sign-in',
      search: { redirect: location.pathname },
    })
  }

  if (
    canAccessBackoffice(session.user.role) &&
    !session.session.impersonatedBy
  ) {
    throw redirect({ to: '/backoffice' })
  }
}

async function getDashboardSession() {
  if (dashboardSessionCache && dashboardSessionCache.expiresAt > Date.now()) {
    return dashboardSessionCache.result
  }

  dashboardSessionPromise ??= authClient
    .getSession()
    .then((result) => {
      dashboardSessionCache = {
        expiresAt: Date.now() + DASHBOARD_SESSION_CACHE_MS,
        result,
      }
      return result
    })
    .finally(() => {
      dashboardSessionPromise = null
    })

  return dashboardSessionPromise
}
