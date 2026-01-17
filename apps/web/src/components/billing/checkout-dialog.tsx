import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PlanSelectionStep } from './plan-selection-step'
import { PaymentMethodStep } from './payment-method-step'
import { CreditCardForm } from './credit-card-form'
import { PixPayment } from './pix-payment'
import { BoletoPayment } from './boleto-payment'
import { ConfirmationStep } from './confirmation-step'
import type { PlanId, BillingCycle } from '@calibra-facil/shared'

// =============================================================================
// TYPES
// =============================================================================

export type CheckoutStep =
  | 'plan-selection'
  | 'payment-method'
  | 'payment-details'
  | 'confirmation'

export type PaymentMethodType = 'CREDIT_CARD' | 'PIX' | 'BOLETO'

export interface CheckoutState {
  step: CheckoutStep
  selectedPlan: PlanId | null
  billingCycle: BillingCycle
  paymentMethod: PaymentMethodType | null
  subscriptionId: number | null
  paymentData: {
    pixQrCodeImage?: string
    pixPayload?: string
    boletoBarcode?: string
    boletoUrl?: string
    boleto?: {
      bankSlipUrl?: string
      barCode?: string
      identificationField?: string
      dueDate?: string
    }
  } | null
}

interface CheckoutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPlanId?: PlanId
}

// =============================================================================
// STEP INDICATOR - Minimal dot-based design
// =============================================================================

function StepIndicator({
  currentStep,
  totalSteps = 4,
}: {
  currentStep: number
  totalSteps?: number
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNumber = i + 1
        const isCompleted = stepNumber < currentStep
        const isActive = stepNumber === currentStep

        return (
          <div
            key={stepNumber}
            className={cn(
              'flex items-center justify-center rounded-full transition-all duration-200',
              isCompleted && 'size-4 bg-primary',
              isActive && 'size-2.5 bg-primary',
              !isCompleted && !isActive && 'size-2 bg-muted-foreground/30',
            )}
          >
            {isCompleted && (
              <HugeiconsIcon
                icon={Tick02Icon}
                className="size-2.5 text-primary-foreground"
                strokeWidth={3}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// CHECKOUT DIALOG
// =============================================================================

const STEP_TITLES: Record<CheckoutStep, { title: string; description: string }> =
  {
    'plan-selection': {
      title: 'Escolha seu plano',
      description: 'Selecione o plano ideal para sua empresa',
    },
    'payment-method': {
      title: 'Forma de pagamento',
      description: 'Como você prefere pagar?',
    },
    'payment-details': {
      title: 'Dados do pagamento',
      description: 'Preencha os dados para concluir',
    },
    confirmation: {
      title: 'Sucesso!',
      description: '',
    },
  }

function getStepNumber(step: CheckoutStep): number {
  switch (step) {
    case 'plan-selection':
      return 1
    case 'payment-method':
      return 2
    case 'payment-details':
      return 3
    case 'confirmation':
      return 4
    default:
      return 1
  }
}

export function CheckoutDialog({
  open,
  onOpenChange,
  currentPlanId,
}: CheckoutDialogProps) {
  const queryClient = useQueryClient()

  const [state, setState] = useState<CheckoutState>({
    step: 'plan-selection',
    selectedPlan: null,
    billingCycle: 'MONTHLY',
    paymentMethod: null,
    subscriptionId: null,
    paymentData: null,
  })

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setState({
        step: 'plan-selection',
        selectedPlan: null,
        billingCycle: 'MONTHLY',
        paymentMethod: null,
        subscriptionId: null,
        paymentData: null,
      })
    }
    onOpenChange(newOpen)
  }

  // Handle plan selection
  const handlePlanSelect = (planId: PlanId, cycle: BillingCycle) => {
    setState((s) => ({
      ...s,
      selectedPlan: planId,
      billingCycle: cycle,
      step: 'payment-method',
    }))
  }

  // Handle payment method selection
  const handlePaymentMethodSelect = (method: PaymentMethodType) => {
    setState((s) => ({
      ...s,
      paymentMethod: method,
      step: 'payment-details',
    }))
  }

  // Handle checkout success
  const handleCheckoutSuccess = (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => {
    setState((s) => ({
      ...s,
      subscriptionId,
      paymentData: paymentData || null,
      step: 'confirmation',
    }))
  }

  // Handle completion
  const handleComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['billing'] })
    handleOpenChange(false)
  }

  // Go back
  const handleBack = () => {
    setState((s) => {
      switch (s.step) {
        case 'payment-method':
          return { ...s, step: 'plan-selection' }
        case 'payment-details':
          return { ...s, step: 'payment-method' }
        default:
          return s
      }
    })
  }

  const canGoBack =
    state.step === 'payment-method' || state.step === 'payment-details'

  // Render current step
  const renderStep = () => {
    switch (state.step) {
      case 'plan-selection':
        return (
          <PlanSelectionStep
            currentPlanId={currentPlanId}
            selectedPlan={state.selectedPlan}
            billingCycle={state.billingCycle}
            onSelect={handlePlanSelect}
          />
        )

      case 'payment-method':
        return <PaymentMethodStep onSelect={handlePaymentMethodSelect} />

      case 'payment-details':
        if (!state.selectedPlan || !state.paymentMethod) return null

        switch (state.paymentMethod) {
          case 'CREDIT_CARD':
            return (
              <CreditCardForm
                planId={state.selectedPlan}
                cycle={state.billingCycle}
                onSuccess={handleCheckoutSuccess}
                onBack={handleBack}
              />
            )
          case 'PIX':
            return (
              <PixPayment
                planId={state.selectedPlan}
                cycle={state.billingCycle}
                onSuccess={handleCheckoutSuccess}
                onBack={handleBack}
              />
            )
          case 'BOLETO':
            return (
              <BoletoPayment
                planId={state.selectedPlan}
                cycle={state.billingCycle}
                onSuccess={handleCheckoutSuccess}
                onBack={handleBack}
              />
            )
        }
        break

      case 'confirmation':
        return (
          <ConfirmationStep
            subscriptionId={state.subscriptionId!}
            paymentMethod={state.paymentMethod!}
            paymentData={state.paymentData}
            onComplete={handleComplete}
          />
        )
    }
  }

  const stepInfo = STEP_TITLES[state.step]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto',
          state.step === 'plan-selection' && 'sm:max-w-4xl',
          state.step === 'payment-method' && 'sm:max-w-md',
          state.step === 'payment-details' &&
            state.paymentMethod === 'CREDIT_CARD' &&
            'sm:max-w-lg',
          state.step === 'payment-details' &&
            state.paymentMethod !== 'CREDIT_CARD' &&
            'sm:max-w-md',
          state.step === 'confirmation' && 'sm:max-w-md',
        )}
      >
        {/* Back Button */}
        {canGoBack && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 size-8"
            onClick={handleBack}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
          </Button>
        )}

        <DialogHeader className="text-center">
          {/* Step Indicator */}
          {state.step !== 'confirmation' && (
            <div className="mb-2">
              <StepIndicator currentStep={getStepNumber(state.step)} />
            </div>
          )}

          <DialogTitle>{stepInfo.title}</DialogTitle>
          {stepInfo.description && (
            <DialogDescription>{stepInfo.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="mt-2">{renderStep()}</div>
      </DialogContent>
    </Dialog>
  )
}
