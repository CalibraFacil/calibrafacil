import * as React from 'react'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
// STEP INDICATOR
// =============================================================================

const steps = [
  { key: 'plan-selection', label: 'Plano' },
  { key: 'payment-method', label: 'Método' },
  { key: 'payment-details', label: 'Pagamento' },
  { key: 'confirmation', label: 'Confirmação' },
]

function StepIndicator({ currentStep }: { currentStep: CheckoutStep }) {
  const currentIndex = steps.findIndex((s) => s.key === currentStep)

  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          <div
            className={`flex items-center gap-2 ${
              index <= currentIndex
                ? 'text-foreground'
                : 'text-muted-foreground'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                index < currentIndex
                  ? 'bg-primary text-primary-foreground'
                  : index === currentIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {index < currentIndex ? '✓' : index + 1}
            </div>
            <span className="text-sm hidden sm:inline">{step.label}</span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`h-px w-8 ${
                index < currentIndex ? 'bg-primary' : 'bg-muted'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// =============================================================================
// CHECKOUT DIALOG
// =============================================================================

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
        return (
          <PaymentMethodStep
            onSelect={handlePaymentMethodSelect}
            onBack={handleBack}
          />
        )

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assinar CalibraFácil</DialogTitle>
          <DialogDescription>
            Escolha o plano ideal para o seu laboratório
          </DialogDescription>
        </DialogHeader>

        <StepIndicator currentStep={state.step} />

        {renderStep()}
      </DialogContent>
    </Dialog>
  )
}
