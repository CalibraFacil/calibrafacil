import { createFileRoute, redirect } from '@tanstack/react-router'
import { SignInPage } from '@/features/auth/sign-in-page'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

type SignInSearch = {
  redirect?: string
}

export const Route = createFileRoute('/sign-in/')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    if (!isDesktopRuntime()) return

    if (await hasDesktopSession()) {
      throw redirect({ to: '/dashboard' })
    }
  },
  head: () => ({
    meta: [
      {
        title: 'Entrar | CalibraFácil',
        name: 'description',
        content: 'Entrar em sua conta CalibraFácil',
      },
    ],
  }),
  component: SignInRoute,
})

function SignInRoute() {
  const { redirect: redirectTo } = Route.useSearch()
  return <SignInPage redirect={redirectTo} />
}
