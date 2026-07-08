import { createFileRoute, redirect } from '@tanstack/react-router'

import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

// The marketing landing is served by the Next app (apps/site) at "/". A full
// browser load of "/" is proxied there by Vercel and never reaches this SPA
// route. This route is only entered via in-app navigation (e.g. a logo <Link
// to="/">) or the desktop/PWA shells, so it always bounces into the product —
// the dashboard guard sends logged-out users on to /sign-in.
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (isDesktopRuntime() && !(await hasDesktopSession())) {
      throw redirect({ to: '/sign-in', search: { redirect: '/dashboard' } })
    }

    throw redirect({ to: '/dashboard' })
  },
})
