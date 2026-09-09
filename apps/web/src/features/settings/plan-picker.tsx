import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  formatPrice,
  getPlan,
  PLAN_PRICES,
  type BillingCycle,
} from '@calibra-facil/shared'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PixIcon } from '@/components/payment-brand-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { CreditCardIcon, Invoice01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { calibraApi } from '@/utils/api'

/** The plans a laboratory can contract on its own, cheapest first. */
const SELF_SERVE_PLANS = ['STANDARD', 'PROFESSIONAL', 'ADVANCED'] as const
type SelfServePlanId = (typeof SELF_SERVE_PLANS)[number]

/** How a lab can pay, in the order the checkout page presents them. */
const PAYMENT_METHODS = ['PIX', 'BOLETO', 'CREDIT_CARD'] as const
type SelfServePaymentMethod = (typeof PAYMENT_METHODS)[number]

const PAYMENT_METHOD_LABELS: Record<SelfServePaymentMethod, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão',
}

type PlanPickerProps = {
  currentPlanId?: string
  /** Preselected on the pricing page, carried through the claim link. */
  suggestedPlanId?: string
  suggestedCycle?: BillingCycle
}

/**
 * Contracting a plan without an operator in the loop.
 *
 * The price shown here and the price charged come from the same `PLAN_PRICES`
 * table, and the server recomputes it from the plan id anyway — a stale tab
 * cannot buy at yesterday's price, and the client never sends an amount.
 */
export function PlanPicker({
  currentPlanId,
  suggestedPlanId,
  suggestedCycle,
}: PlanPickerProps) {
  const [cycle, setCycle] = useState<BillingCycle>(suggestedCycle ?? 'YEARLY')
  const [selected, setSelected] = useState<SelfServePlanId>(
    isSelfServePlan(suggestedPlanId) ? suggestedPlanId : 'STANDARD',
  )
  const [paymentMethod, setPaymentMethod] =
    useState<SelfServePaymentMethod>('CREDIT_CARD')
  const queryClient = useQueryClient()

  const checkout = useMutation({
    mutationFn: () =>
      calibraApi.billing.startSelfServeCheckout({
        planId: selected,
        billingCycle: cycle,
        paymentMethod,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['billing'] })
      // Hand off to the public checkout page, which already renders Pix,
      // boleto and the card redirect.
      window.location.assign(result.checkoutPath)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível iniciar a contratação',
      )
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contratar um plano</CardTitle>
        <CardDescription>
          Escolha o plano e o ciclo. O acesso é liberado assim que o pagamento é
          confirmado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="group"
          aria-label="Ciclo de cobrança"
          className="inline-flex items-center gap-1 rounded-full border p-1"
        >
          <CycleButton
            selected={cycle === 'YEARLY'}
            onSelect={() => setCycle('YEARLY')}
          >
            Anual · 2 meses grátis
          </CycleButton>
          <CycleButton
            selected={cycle === 'MONTHLY'}
            onSelect={() => setCycle('MONTHLY')}
          >
            Mensal
          </CycleButton>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {SELF_SERVE_PLANS.map((planId) => {
            const plan = getPlan(planId)
            const prices = PLAN_PRICES[planId]
            const total = cycle === 'YEARLY' ? prices.yearly : prices.monthly
            const perMonth = cycle === 'YEARLY' ? prices.yearly / 12 : total
            const isCurrent = currentPlanId === planId

            return (
              <button
                key={planId}
                type="button"
                aria-pressed={selected === planId}
                onClick={() => setSelected(planId)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  selected === planId
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{plan.name}</span>
                  {isCurrent ? <Badge variant="outline">Atual</Badge> : null}
                </div>
                <p className="mt-2 text-lg font-semibold tabular-nums">
                  {formatPrice(Math.round(perMonth))}
                  <span className="text-sm font-normal text-muted-foreground">
                    /mês
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {cycle === 'YEARLY'
                    ? `${formatPrice(total)} por ano`
                    : 'cobrança mensal'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {plan.limits.certificates.toLocaleString('pt-BR')}{' '}
                  calibrações/mês · usuários ilimitados
                </p>
              </button>
            )
          })}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Forma de pagamento</p>
          <div
            role="radiogroup"
            aria-label="Forma de pagamento"
            className="flex flex-wrap gap-2"
          >
            {PAYMENT_METHODS.map((method) => (
              <PaymentMethodButton
                key={method}
                method={method}
                selected={paymentMethod === method}
                onSelect={() => setPaymentMethod(method)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {paymentMethod === 'CREDIT_CARD'
              ? 'A renovação é automática no cartão.'
              : 'A cada ciclo enviamos uma nova cobrança para você pagar.'}
          </p>
        </div>

        <Button
          onClick={() => checkout.mutate()}
          disabled={checkout.isPending}
          className="w-full sm:w-auto"
        >
          {checkout.isPending
            ? 'Preparando o pagamento'
            : `Contratar ${getPlan(selected).name}`}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * The method is frozen onto the offer at issuance and the checkout page renders
 * only that one, so this has to be a choice rather than a list of logos: with
 * no control the API defaulted every purchase to card and Pix was unreachable.
 * The Pix mark is at the 24px its brand manual asks for.
 */
function PaymentMethodButton({
  method,
  selected,
  onSelect,
}: {
  method: SelfServePaymentMethod
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      {method === 'PIX' ? (
        <PixIcon className="size-6" />
      ) : (
        <HugeiconsIcon
          icon={method === 'BOLETO' ? Invoice01Icon : CreditCardIcon}
          className="size-4"
        />
      )}
      {PAYMENT_METHOD_LABELS[method]}
    </button>
  )
}

function isSelfServePlan(value: string | undefined): value is SelfServePlanId {
  return SELF_SERVE_PLANS.some((plan) => plan === value)
}

function CycleButton({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'rounded-full px-3 py-1 text-sm transition-colors',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
