import { redirect } from '@tanstack/react-router'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
import { authClient } from '@calibra-facil/auth/client'

import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'
import { readSessionWithRetry } from '@/lib/auth-session'

let dashboardSessionPromise: ReturnType<typeof authClient.getSession> | null =
  null

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

  const { data: session } = await readSessionWithRetry(getDashboardSession)

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
  dashboardSessionPromise ??= authClient.getSession().finally(() => {
    dashboardSessionPromise = null
  })

  return dashboardSessionPromise
}
