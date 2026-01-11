import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import type { CheckoutState, PaymentMethodType } from './checkout-dialog'
import { Button } from '@/components/ui/button'

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
  const isPending = paymentMethod === 'BOLETO' && !!paymentData?.boleto

  return (
    <div className="flex flex-col items-center space-y-6 py-6">
      {/* Success Icon */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          className="text-green-600 dark:text-green-400"
          size={48}
        />
      </div>

      {/* Title */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">
          {isPending ? 'Boleto Gerado!' : 'Assinatura Ativada!'}
        </h2>
        <p className="text-muted-foreground max-w-md">
          {getConfirmationMessage(paymentMethod, isPending)}
        </p>
      </div>

      {/* Boleto Details (if applicable) */}
      {isPending && paymentData?.boleto && (
        <div className="w-full max-w-md rounded-lg border bg-muted/50 p-4 space-y-3">
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
      <div className="w-full max-w-md rounded-lg bg-muted/50 p-4">
        <p className="text-sm font-medium mb-2">Próximos passos:</p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {getNextSteps(paymentMethod, isPending).map((step, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ul>
      </div>

      {/* Complete Button */}
      <Button onClick={onComplete} className="w-full max-w-md">
        {isPending ? 'Entendi' : 'Comecar a usar'}
      </Button>
    </div>
  )
}

function getConfirmationMessage(
  method: PaymentMethodType,
  isPending: boolean,
): string {
  if (isPending) {
    return 'Seu boleto foi gerado com sucesso. Após o pagamento ser confirmado, sua assinatura será ativada automaticamente.'
  }

  switch (method) {
    case 'CREDIT_CARD':
      return 'Seu pagamento foi processado com sucesso e sua assinatura já está ativa. Aproveite todos os recursos do seu plano!'
    case 'PIX':
      return 'Seu pagamento PIX foi confirmado e sua assinatura já está ativa. Aproveite todos os recursos do seu plano!'
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
      'Você receberá um email quando a assinatura for ativada',
      'Enquanto isso, você pode continuar usando o plano gratuito',
    ]
  }

  return [
    'Explore os novos recursos disponíveis no seu plano',
    'Configure seu laboratório com as novas funcionalidades',
    'Acesse a página de faturamento para ver seu histórico',
    'Entre em contato se precisar de ajuda',
  ]
}
