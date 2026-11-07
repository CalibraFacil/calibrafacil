import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasRuntimeSession } from '@/app/session/runtime-session'
import { OrganizationOnboardingPage } from '@/features/onboarding/organization-page'

type OnboardingSearch = {
  redirect?: string
}

export const Route = createFileRoute('/onboarding/organization')({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    if (!(await hasRuntimeSession())) {
      throw redirect({ to: '/sign-in' })
    }
  },
  component: OrganizationOnboardingRoute,
})

function OrganizationOnboardingRoute() {
  const { redirect: redirectTo } = Route.useSearch()

  return <OrganizationOnboardingPage redirectTo={redirectTo} />
}
