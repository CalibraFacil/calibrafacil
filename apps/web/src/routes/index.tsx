import { createFileRoute, redirect } from '@tanstack/react-router'

import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

// The lab app has no landing page of its own (the project site is apps/site),
// so "/" always bounces into the product; the dashboard guard sends logged-out
// users on to /sign-in.
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (isDesktopRuntime() && !(await hasDesktopSession())) {
      throw redirect({ to: '/sign-in', search: { redirect: '/dashboard' } })
    }

    throw redirect({ to: '/dashboard' })
  },
})
