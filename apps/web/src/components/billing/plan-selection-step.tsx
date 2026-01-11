import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  PLANS,
  PLAN_PRICES,
  formatPrice,
  type PlanId,
  type BillingCycle,
} from '@calibra-facil/shared'

interface PlanSelectionStepProps {
  currentPlanId?: PlanId
  selectedPlan: PlanId | null
  billingCycle: BillingCycle
  onSelect: (planId: PlanId, cycle: BillingCycle) => void
}

// Feature descriptions for display
const FEATURE_DESCRIPTIONS: Record<string, string> = {
  math_engine: 'Cálculo avançado de incerteza',
  portal: 'Portal do cliente',
  financial: 'Módulo financeiro',
  api: 'Acesso via API',
  custom_domain: 'Domínio personalizado',
}

// Plans to show in checkout (excludes FREE)
type CheckoutPlanId = Exclude<PlanId, 'FREE'>
const CHECKOUT_PLANS: Array<CheckoutPlanId> = [
  'STANDARD',
  'PROFESSIONAL',
  'ENTERPRISE',
]

export function PlanSelectionStep({
  currentPlanId,
  selectedPlan,
  billingCycle,
  onSelect,
}: PlanSelectionStepProps) {
  const [cycle, setCycle] = useState<BillingCycle>(billingCycle)

  const handleSelect = (planId: PlanId) => {
    onSelect(planId, cycle)
  }

  return (
    <div className="space-y-6">
      {/* Billing cycle toggle */}
      <div className="flex justify-center gap-2">
        <Button
          variant={cycle === 'MONTHLY' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCycle('MONTHLY')}
        >
          Mensal
        </Button>
        <Button
          variant={cycle === 'YEARLY' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCycle('YEARLY')}
        >
          Anual
          <Badge variant="secondary" className="ml-2 text-xs">
            -17%
          </Badge>
        </Button>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CHECKOUT_PLANS.map((planId) => {
          const plan = PLANS[planId]
          const prices = PLAN_PRICES[planId]
          const price = cycle === 'MONTHLY' ? prices.monthly : prices.yearly
          const isCurrentPlan = planId === currentPlanId
          const isPopular = planId === 'PROFESSIONAL'

          return (
            <Card
              key={planId}
              className={`relative flex flex-col ${
                isPopular
                  ? 'border-primary shadow-lg scale-[1.02] z-10'
                  : 'border-border'
              } ${selectedPlan === planId ? 'ring-2 ring-primary' : ''}`}
            >
              {isPopular && (
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <Badge className="bg-primary text-primary-foreground font-semibold">
                    Mais Popular
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-4">
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">
                    {formatPrice(price)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    /{cycle === 'MONTHLY' ? 'mes' : 'ano'}
                  </span>
                </div>
                {cycle === 'YEARLY' && (
                  <p className="text-xs text-muted-foreground">
                    Equivale a {formatPrice(Math.round(price / 12))}/mês
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex-1 space-y-3">
                {/* Limits */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      className="text-primary shrink-0"
                      size={16}
                    />
                    <span>
                      {plan.limits.certificates === 999999
                        ? 'Certificados ilimitados'
                        : `${plan.limits.certificates} certificados/mês`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      className="text-primary shrink-0"
                      size={16}
                    />
                    <span>
                      {plan.limits.users === 999
                        ? 'Usuários ilimitados'
                        : `${plan.limits.users} usuários`}
                    </span>
                  </div>
                </div>

                {/* Features */}
                {plan.features.length > 0 && (
                  <div className="pt-2 border-t space-y-2 text-sm">
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-center gap-2">
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="text-primary shrink-0"
                          size={16}
                        />
                        <span>{FEATURE_DESCRIPTIONS[feature] || feature}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>

              <CardFooter>
                <Button
                  className="w-full"
                  variant={isPopular ? 'default' : 'outline'}
                  disabled={isCurrentPlan}
                  onClick={() => handleSelect(planId)}
                >
                  {isCurrentPlan ? 'Plano atual' : `Escolher ${plan.name}`}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
