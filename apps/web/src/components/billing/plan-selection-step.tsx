import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Tick02Icon,
  Cancel01Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ENTITLEMENT_METADATA,
  PLANS,
  PLAN_PRICES,
  formatPrice,
  hasFeature,
  type PlanId,
  type BillingCycle,
  type FeatureFlag,
} from '@calibra-facil/shared'

interface PlanSelectionStepProps {
  currentPlanId?: PlanId
  selectedPlan: PlanId | null
  billingCycle: BillingCycle
  onSelect: (planId: PlanId, cycle: BillingCycle) => void
}

// All features in display order
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

// Plans to show in checkout (excludes FREE)
type CheckoutPlanId = Exclude<PlanId, 'FREE'>
const CHECKOUT_PLANS: Array<CheckoutPlanId> = [
  'STANDARD',
  'PROFESSIONAL',
  'ENTERPRISE',
]

// Plan order for upgrade comparison
const PLAN_ORDER: PlanId[] = ['FREE', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']

const PLAN_HIGHLIGHTS: Record<CheckoutPlanId, string[]> = {
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

export function PlanSelectionStep({
  currentPlanId,
  billingCycle,
  onSelect,
}: PlanSelectionStepProps) {
  const [cycle, setCycle] = useState<BillingCycle>(billingCycle)

  const handleSelect = (planId: PlanId) => {
    onSelect(planId, cycle)
  }

  const canUpgrade = (planId: PlanId) => {
    if (!currentPlanId) return true
    return PLAN_ORDER.indexOf(planId) > PLAN_ORDER.indexOf(currentPlanId)
  }

  const getMonthlyEquivalent = (planId: CheckoutPlanId) => {
    const prices = PLAN_PRICES[planId]
    if (cycle === 'YEARLY') {
      return Math.round(prices.yearly / 12)
    }
    return prices.monthly
  }

  const getPrice = (planId: CheckoutPlanId) => {
    const prices = PLAN_PRICES[planId]
    return cycle === 'YEARLY' ? prices.yearly : prices.monthly
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Billing Cycle Toggle - Pill design */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setCycle('MONTHLY')}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-all',
              cycle === 'MONTHLY'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Mensal
          </button>
          <button
            type="button"
            onClick={() => setCycle('YEARLY')}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-all',
              cycle === 'YEARLY'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Anual
            <span className="ml-1.5 text-xs text-green-600">-17%</span>
          </button>
        </div>
      </div>

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CHECKOUT_PLANS.map((planId) => {
          const plan = PLANS[planId]
          const isCurrent = currentPlanId === planId
          const isPopular = Boolean(plan.isPopular)
          const canSelect = canUpgrade(planId)

          return (
            <div
              key={planId}
              className={cn(
                'relative flex flex-col rounded-xl border p-4 transition-all',
                isCurrent
                  ? 'cursor-not-allowed border-muted bg-muted/30'
                  : canSelect
                    ? 'cursor-pointer border-border hover:border-primary/50'
                    : 'cursor-not-allowed border-muted bg-muted/30',
                isPopular && !isCurrent && 'border-primary/30',
              )}
            >
              {/* Popular Badge */}
              {isPopular && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    <HugeiconsIcon icon={SparklesIcon} className="size-3" />
                    Mais Popular
                  </span>
                </div>
              )}

              {/* Current Plan Badge */}
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center rounded-full bg-muted-foreground px-3 py-1 text-xs font-medium text-background">
                    Plano Atual
                  </span>
                </div>
              )}

              {/* Plan Header */}
              <div
                className={cn(
                  'text-center',
                  (isPopular || isCurrent) && 'mt-2',
                )}
              >
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

              {/* Price */}
              <div className="mt-4 text-center">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-bold">
                    {formatPrice(getMonthlyEquivalent(planId))}
                  </span>
                  <span className="text-sm text-muted-foreground">/mês</span>
                </div>
                {cycle === 'YEARLY' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    cobrado {formatPrice(getPrice(planId))}/ano
                  </p>
                )}
              </div>

              {/* Limits */}
              <div className="mt-4 space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Certificados/mês
                  </span>
                  <span className="font-medium">
                    {plan.limits.certificates === 999999
                      ? 'Ilimitados'
                      : plan.limits.certificates}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Usuários</span>
                  <span className="font-medium">
                    {plan.limits.users === 999
                      ? 'Ilimitados'
                      : plan.limits.users}
                  </span>
                </div>
              </div>

              {/* Commercial Highlights */}
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

              {/* Features */}
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

              {/* Select Button */}
              <div className="mt-4 border-t pt-4">
                {isCurrent ? (
                  <Button variant="outline" disabled className="w-full">
                    Plano Atual
                  </Button>
                ) : !canSelect ? (
                  <Button variant="outline" disabled className="w-full">
                    Indisponível
                  </Button>
                ) : (
                  <Button
                    variant={isPopular ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => handleSelect(planId)}
                  >
                    Selecionar
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
