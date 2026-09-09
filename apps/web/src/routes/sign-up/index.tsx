import { createFileRoute } from '@tanstack/react-router'
import { SignUpPage } from '@/features/auth/sign-up-page'

type SelfServePlanId = 'STANDARD' | 'PROFESSIONAL' | 'ADVANCED'
type SignUpSearch = {
  plano: SelfServePlanId
  ciclo: 'MONTHLY' | 'YEARLY'
}

const PLAN_BY_SLUG: Record<string, SelfServePlanId> = {
  essencial: 'STANDARD',
  profissional: 'PROFESSIONAL',
  professional: 'PROFESSIONAL',
  avancado: 'ADVANCED',
  STANDARD: 'STANDARD',
  PROFESSIONAL: 'PROFESSIONAL',
  ADVANCED: 'ADVANCED',
}

export const Route = createFileRoute('/sign-up/')({
  // The marketing site links here with the plan slug it shows publicly
  // ("essencial"), so both spellings resolve to the same plan id.
  validateSearch: (search: Record<string, unknown>): SignUpSearch => {
    const rawPlan = typeof search.plano === 'string' ? search.plano : ''
    const rawCycle = typeof search.ciclo === 'string' ? search.ciclo : ''

    return {
      plano: PLAN_BY_SLUG[rawPlan] ?? 'STANDARD',
      ciclo: rawCycle.toUpperCase() === 'MONTHLY' ? 'MONTHLY' : 'YEARLY',
    }
  },
  head: () => ({
    meta: [
      {
        title: 'Criar conta | CalibraFácil',
        name: 'description',
        content: 'Abrir a conta do seu laboratório no CalibraFácil',
      },
    ],
  }),
  component: SignUpRoute,
})

function SignUpRoute() {
  const { plano, ciclo } = Route.useSearch()
  return <SignUpPage planId={plano} billingCycle={ciclo} />
}
