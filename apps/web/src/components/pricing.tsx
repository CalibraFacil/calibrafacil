import React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Cancel01Icon,
  SparklesIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ENTITLEMENT_METADATA,
  PLANS,
  hasFeature,
  type FeatureFlag,
  type PlanId,
} from '@calibra-facil/shared'

type LandingPlanId = Exclude<PlanId, 'FREE'>

const LANDING_PLANS: Array<LandingPlanId> = [
  'STANDARD',
  'PROFESSIONAL',
  'ENTERPRISE',
]

const ALL_FEATURES: FeatureFlag[] = [
  'math_engine',
  'portal',
  'financial',
  'api',
  'custom_domain',
  'sso',
  'approval_workflow',
  'advanced_audit_trail',
  'custom_templates',
  'priority_support',
  'multi_unit',
  'custom_integrations',
]

const PLAN_HIGHLIGHTS: Record<LandingPlanId, string[]> = {
  STANDARD: [
    'Portal do cliente incluído',
    'Templates padrão de certificado',
    'Suporte padrão',
  ],
  PROFESSIONAL: [
    'Fluxo de revisão e aprovação',
    'Templates personalizados',
    'Suporte prioritário',
  ],
  ENTERPRISE: [
    'SSO corporativo via OIDC',
    'Suporte dedicado sob consulta',
    'Onboarding assistido',
    'Soluções customizadas para operação complexa',
  ],
}

const CONTACT_URL = 'https://cal.com/calibrafacil/30min?user=calibrafacil'

const Pricing: React.FC = () => {
  return (
    <section id="pricing" className="border-t bg-background py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Planos para diferentes estágios da operação
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            A base técnica permanece consistente. O que evolui é a governança,
            a extensibilidade e o nível de suporte para o laboratório.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {LANDING_PLANS.map((planId) => {
            const plan = PLANS[planId]
            const isPopular = Boolean(plan.isPopular)

            return (
              <div
                key={planId}
                className={cn(
                  'relative flex flex-col rounded-xl border p-4 transition-all',
                  'border-border bg-background',
                  isPopular && 'border-primary/30',
                )}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      <HugeiconsIcon icon={SparklesIcon} className="size-3" />
                      Mais Popular
                    </span>
                  </div>
                )}

                <div className={cn('text-center', isPopular && 'mt-2')}>
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {plan.description}
                  </p>
                  {plan.recommendedFor && (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {plan.recommendedFor}
                    </p>
                  )}
                </div>

                <div className="mt-4 space-y-2 border-t pt-4">
                  {PLAN_HIGHLIGHTS[planId].map((highlight) => (
                    <div
                      key={highlight}
                      className="flex items-center gap-2 text-sm"
                    >
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="size-4 shrink-0 text-primary"
                      />
                      <span>{highlight}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex-1 space-y-2 border-t pt-4">
                  {ALL_FEATURES.map((feature) => {
                    const has = hasFeature(planId, feature)
                    const label = ENTITLEMENT_METADATA[feature]

                    return (
                      <div
                        key={feature}
                        className={cn(
                          'flex items-center gap-2 text-sm',
                          !has && 'text-muted-foreground/50',
                        )}
                      >
                        <HugeiconsIcon
                          icon={has ? Tick02Icon : Cancel01Icon}
                          className={cn(
                            'size-4 shrink-0',
                            has ? 'text-green-600' : 'text-muted-foreground/30',
                          )}
                        />
                        <span className={cn(!has && 'line-through')}>
                          {label.name}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 border-t pt-4">
                  <Button
                    asChild
                    variant={isPopular ? 'default' : 'outline'}
                    className="w-full"
                  >
                    <a
                      href={CONTACT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <span>Falar com Especialista</span>
                        <HugeiconsIcon
                          icon={ArrowRight01Icon}
                          className="size-4 shrink-0"
                        />
                      </span>
                    </a>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default Pricing
