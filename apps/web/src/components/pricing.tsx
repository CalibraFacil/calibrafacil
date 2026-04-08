import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { SparklesIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import {
  ENTITLEMENT_METADATA,
  PLANS,
  PLAN_PRICES,
  formatPrice,
  getEnabledEntitlements,
  type PlanId,
} from '@calibra-facil/shared'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type PublicPlanId = Exclude<PlanId, 'FREE'>

const PUBLIC_PLANS: PublicPlanId[] = ['STANDARD', 'PROFESSIONAL', 'ENTERPRISE']

const PLAN_HIGHLIGHTS: Record<PublicPlanId, string[]> = {
  STANDARD: [
    'Até 100 certificados por mês',
    'Até 5 usuários',
    'Portal do cliente incluído',
    'Templates padrão de certificado',
  ],
  PROFESSIONAL: [
    'Até 800 certificados por mês',
    'Usuários ilimitados',
    'API, domínio personalizado e módulo financeiro',
    'Fluxo de aprovação e trilha de auditoria avançada',
  ],
  ENTERPRISE: [
    'Certificados e usuários ilimitados',
    'Multiunidade e integrações personalizadas',
    'SSO corporativo para o dashboard',
    'Suporte dedicado e onboarding assistido',
    'Escopo operacional sob consulta',
  ],
}

const Pricing: React.FC = () => {
  const navigate = useNavigate()

  return (
    <section
      id="pricing"
      className="border-t border-slate-100 bg-white py-24 dark:border-slate-900 dark:bg-slate-950"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 dark:text-white md:text-4xl">
            Escolha seu plano
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            O núcleo metrológico permanece em todos os planos. O que muda é a
            capacidade operacional, governança e escala.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {PUBLIC_PLANS.map((planId) => {
            const plan = PLANS[planId]
            const monthlyPrice = formatPrice(PLAN_PRICES[planId].monthly)

            return (
              <Card
                key={planId}
                className={`relative flex flex-col ${
                  plan.isPopular
                    ? 'z-10 scale-105 border-sky-500 bg-white shadow-xl shadow-sky-900/10 dark:bg-slate-900 dark:shadow-sky-900/20'
                    : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50'
                }`}
              >
                {plan.isPopular && (
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                    <Badge className="rounded-full bg-sky-500 font-bold uppercase tracking-wide text-white hover:bg-sky-500">
                      <HugeiconsIcon
                        icon={SparklesIcon}
                        className="mr-1 size-3"
                      />
                      Mais Popular
                    </Badge>
                  </div>
                )}

                <CardHeader>
                  <CardTitle className="mb-2 text-xl font-bold text-slate-900 dark:text-white">
                    {plan.name}
                  </CardTitle>
                  <div className="mb-4 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-slate-900 dark:text-white">
                      {monthlyPrice}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      /mês
                    </span>
                  </div>
                  <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                    {plan.description}
                  </CardDescription>
                  {plan.recommendedFor && (
                    <p className="mt-3 text-sm font-medium text-sky-600 dark:text-sky-400">
                      {plan.recommendedFor}
                    </p>
                  )}
                </CardHeader>

                <CardContent className="flex-1 space-y-6">
                  <ul className="space-y-4">
                    {PLAN_HIGHLIGHTS[planId].map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300"
                      >
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="shrink-0 text-sky-500"
                          size={18}
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Recursos incluídos
                    </p>
                    <ul className="space-y-3">
                      {getEnabledEntitlements(planId).map((feature) => (
                        <li
                          key={feature}
                          className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300"
                        >
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            className="shrink-0 text-sky-500"
                            size={16}
                          />
                          <span>{ENTITLEMENT_METADATA[feature].name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>

                <CardFooter>
                  <Button
                    className={`w-full font-semibold ${
                      plan.isPopular
                        ? 'bg-sky-600 text-white hover:bg-sky-500'
                        : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                    }`}
                    onClick={() =>
                      navigate({
                        to: '/sign-up',
                        search: {
                          redirect: '/dashboard/settings/billing',
                        },
                      })
                    }
                  >
                    Escolher {plan.name}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default Pricing
