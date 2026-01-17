import { useEffect, useState } from 'react'
import type { CheckoutState, PaymentMethodType } from './checkout-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ConfirmationStepProps {
  subscriptionId: number
  paymentMethod: PaymentMethodType
  paymentData: CheckoutState['paymentData']
  onComplete: () => void
}

export function ConfirmationStep({
  paymentMethod,
  paymentData,
  onComplete,
}: ConfirmationStepProps) {
  const [showCheckmark, setShowCheckmark] = useState(false)
  const [showContent, setShowContent] = useState(false)

  const isPending = paymentMethod === 'BOLETO' && !!paymentData?.boleto

  // Stagger animations
  useEffect(() => {
    const checkmarkTimer = setTimeout(() => setShowCheckmark(true), 100)
    const contentTimer = setTimeout(() => setShowContent(true), 600)

    return () => {
      clearTimeout(checkmarkTimer)
      clearTimeout(contentTimer)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Animated Checkmark */}
      <div
        className={cn(
          'flex size-20 items-center justify-center rounded-full transition-all duration-500',
          isPending
            ? 'bg-amber-500'
            : 'bg-green-500',
          showCheckmark ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      >
        <svg
          className="size-10 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            style={{
              strokeDasharray: 100,
              strokeDashoffset: showCheckmark ? 0 : 100,
              transition: 'stroke-dashoffset 0.5s ease-in-out 0.2s',
            }}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      {/* Title */}
      <div
        className={cn(
          'text-center transition-all duration-500',
          showContent
            ? 'translate-y-0 opacity-100'
            : 'translate-y-4 opacity-0',
        )}
      >
        <h2 className="text-xl font-semibold">
          {isPending ? 'Boleto Gerado!' : 'Pagamento Confirmado!'}
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {getConfirmationMessage(paymentMethod, isPending)}
        </p>
      </div>

      {/* Boleto Details (if applicable) */}
      {isPending && paymentData?.boleto && (
        <div
          className={cn(
            'w-full max-w-sm space-y-3 rounded-lg border bg-muted/50 p-4 transition-all duration-500',
            showContent
              ? 'translate-y-0 opacity-100'
              : 'translate-y-4 opacity-0',
          )}
        >
          <p className="text-sm font-medium">Detalhes do Boleto:</p>

          {paymentData.boleto.dueDate && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Vencimento:</span>
              <span>
                {new Date(paymentData.boleto.dueDate).toLocaleDateString(
                  'pt-BR',
                )}
              </span>
            </div>
          )}

          {paymentData.boleto.bankSlipUrl && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                window.open(paymentData.boleto?.bankSlipUrl, '_blank')
              }
            >
              Baixar Boleto PDF
            </Button>
          )}
        </div>
      )}

      {/* Next Steps */}
      <div
        className={cn(
          'w-full max-w-sm rounded-lg bg-muted/50 p-4 transition-all duration-500 delay-100',
          showContent
            ? 'translate-y-0 opacity-100'
            : 'translate-y-4 opacity-0',
        )}
      >
        <p className="mb-2 text-sm font-medium">Próximos passos:</p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {getNextSteps(paymentMethod, isPending).map((step, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ul>
      </div>

      {/* Complete Button */}
      <Button
        onClick={onComplete}
        className={cn(
          'w-full max-w-sm transition-all duration-500 delay-200',
          showContent
            ? 'translate-y-0 opacity-100'
            : 'translate-y-4 opacity-0',
        )}
        size="lg"
      >
        {isPending ? 'Entendi' : 'Começar a usar'}
      </Button>
    </div>
  )
}

function getConfirmationMessage(
  method: PaymentMethodType,
  isPending: boolean,
): string {
  if (isPending) {
    return 'Seu boleto foi gerado. Após o pagamento, sua assinatura será ativada automaticamente.'
  }

  switch (method) {
    case 'CREDIT_CARD':
      return 'Seu pagamento foi processado e sua assinatura já está ativa!'
    case 'PIX':
      return 'Seu pagamento PIX foi confirmado e sua assinatura já está ativa!'
    default:
      return 'Sua assinatura foi ativada com sucesso!'
  }
}

function getNextSteps(
  _method: PaymentMethodType,
  isPending: boolean,
): Array<string> {
  if (isPending) {
    return [
      'Pague o boleto em qualquer banco ou app',
      'Aguarde a confirmação (até 3 dias úteis)',
      'Você receberá um email quando ativar',
    ]
  }

  return [
    'Explore os novos recursos do seu plano',
    'Configure seu laboratório',
    'Acesse o faturamento para ver seu histórico',
  ]
}
