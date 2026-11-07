import { createFileRoute, redirect } from '@tanstack/react-router'
import { authClient } from '@calibra-facil/auth/client'
import { readSessionWithRetry } from '@calibra-facil/shared/session-retry'
import { getClientSession } from '@/lib/auth-session'
import { OrganizationOnboardingPage } from '@/features/onboarding/organization-page'

// readSessionWithRetry's naked type parameter widens TSession to `{}`, so name
// it explicitly off the auth client (same pattern as the dashboard guard).
type OnboardingSession = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>['data']
>

type OnboardingSearch = {
  redirect?: string
}

export const Route = createFileRoute('/onboarding/organization')({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    const { data: session } =
      await readSessionWithRetry<OnboardingSession>(getClientSession)

    if (!session) {
      throw redirect({ to: '/sign-in' })
    }
  },
  component: OrganizationOnboardingRoute,
})

function OrganizationOnboardingRoute() {
  const { redirect: redirectTo } = Route.useSearch()

  return <OrganizationOnboardingPage redirectTo={redirectTo} />
}
