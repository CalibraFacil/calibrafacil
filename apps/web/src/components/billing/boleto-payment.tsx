import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Copy01Icon,
  Tick02Icon,
  Download01Icon,
  Calendar03Icon,
  Loading03Icon,
} from '@hugeicons/core-free-icons'
import { PLAN_PRICES, formatPrice } from '@calibra-facil/shared'
import type { BillingCycle, PlanId } from '@calibra-facil/shared'
import type { CheckoutState } from './checkout-dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { api } from '@/utils/api'
import { useMountEffect } from '@/hooks/use-mount-effect'

interface BoletoPaymentProps {
  planId: PlanId
  cycle: BillingCycle
  onSuccess: (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => void
  onBack: () => void
}

// Type for boleto data from API
interface BoletoData {
  bankSlipUrl?: string
  barCode?: string
  identificationField?: string
  dueDate?: string
}

// Format linha digitável for display
function formatLinhaDigitavel(value: string): string {
  if (!value) return ''
  // Format: XXXXX.XXXXX XXXXX.XXXXXX XXXXX.XXXXXX X XXXXXXXXXXXXXX
  const clean = value.replace(/\D/g, '')
  if (clean.length !== 47) return value

  return `${clean.slice(0, 5)}.${clean.slice(5, 10)} ${clean.slice(10, 15)}.${clean.slice(15, 21)} ${clean.slice(21, 26)}.${clean.slice(26, 32)} ${clean.slice(32, 33)} ${clean.slice(33)}`
}

export function BoletoPayment({
  planId,
  cycle,
  onSuccess,
  onBack,
}: BoletoPaymentProps) {
  const billingCheckoutApi = (api.api.billing as unknown as { checkout: any })
    .checkout
  const [subscriptionId, setSubscriptionId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const prices = PLAN_PRICES[planId as Exclude<PlanId, 'FREE'>]
  const price = cycle === 'MONTHLY' ? prices?.monthly : prices?.yearly

  // Create subscription with Boleto
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const response = await billingCheckoutApi.boleto.$post({
        json: {
          planId: planId as Exclude<PlanId, 'FREE'>,
          cycle,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(
          (error as { message?: string }).message || 'Erro ao gerar boleto',
        )
      }

      return response.json()
    },
    onSuccess: (data) => {
      setSubscriptionId(data.subscriptionId)
    },
  })

  // Poll for payment status (optional - boleto takes days)
  const statusQuery = useQuery({
    queryKey: ['checkout-status', subscriptionId],
    queryFn: async () => {
      if (!subscriptionId) return null

      const response = await billingCheckoutApi.status[':subscriptionId'].$get({
        param: { subscriptionId: String(subscriptionId) },
      })

      if (!response.ok) {
        throw new Error('Erro ao verificar status')
      }

      return response.json()
    },
    enabled: !!subscriptionId,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.status === 'ACTIVE') return false
      return 30000 // Poll every 30 seconds (boleto is slow)
    },
  })

  const isActive = statusQuery.data?.status === 'ACTIVE'

  // Get boleto data with proper typing
  const boletoData = checkoutMutation.data?.boleto as
    | BoletoData
    | null
    | undefined

  const handleCopy = async () => {
    const barcode = boletoData?.identificationField
    if (barcode) {
      try {
        await navigator.clipboard.writeText(barcode)
        setCopied(true)
        toast.success('Linha digitável copiada!')
        setTimeout(() => setCopied(false), 2000)
      } catch {
        toast.error('Erro ao copiar')
      }
    }
  }

  const handleDownload = () => {
    if (boletoData?.bankSlipUrl) {
      window.open(boletoData.bankSlipUrl, '_blank')
    }
  }

  const formattedDueDate = boletoData?.dueDate
    ? new Date(boletoData.dueDate + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : null

  // Loading state
  if (checkoutMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-10 animate-spin text-primary"
        />
        <p className="text-muted-foreground">Gerando boleto...</p>
      </div>
    )
  }

  // Error state
  if (checkoutMutation.isError) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertDescription>
            {checkoutMutation.error instanceof Error
              ? checkoutMutation.error.message
              : 'Erro ao gerar boleto'}
          </AlertDescription>
        </Alert>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            Voltar
          </Button>
          <Button onClick={() => checkoutMutation.mutate()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {!subscriptionId && !checkoutMutation.isPending && !checkoutMutation.data ? (
        <BoletoCheckoutStarter onStart={() => checkoutMutation.mutate()} />
      ) : null}
      {isActive && subscriptionId ? (
        <BoletoSuccessNotifier
          subscriptionId={subscriptionId}
          onSuccess={onSuccess}
        />
      ) : null}
      {/* Header */}
      <div className="text-center">
        <h3 className="text-lg font-semibold">Boleto Gerado</h3>
        <p className="text-sm text-muted-foreground">
          Pague pelo app do banco ou em qualquer lotérica
        </p>
      </div>

      {/* Value */}
      <div className="text-center">
        <p className="text-3xl font-semibold">{formatPrice(price || 0)}</p>
      </div>

      {/* Linha Digitável */}
      {boletoData?.identificationField && (
        <div className="w-full space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            Linha digitável
          </p>
          <div className="flex gap-2">
            <div className="flex-1 break-all rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
              {formatLinhaDigitavel(boletoData.identificationField)}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              className="shrink-0 self-start"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                className="size-4"
              />
            </Button>
          </div>
        </div>
      )}

      {/* Due Date */}
      {formattedDueDate && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-3 text-sm">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="size-4 text-amber-600"
          />
          <span className="text-amber-700 dark:text-amber-400">
            Vencimento: <strong>{formattedDueDate}</strong>
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex w-full flex-col gap-3">
        {boletoData?.bankSlipUrl && (
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <HugeiconsIcon icon={Download01Icon} className="size-4" />
            Baixar PDF do Boleto
          </Button>
        )}
      </div>

      {/* Waiting Status */}
      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
          <span>Aguardando pagamento...</span>
        </div>
        <p className="text-center text-xs">
          A confirmação pode levar de 1 a 3 dias úteis após o pagamento
        </p>
      </div>
    </div>
  )
}

function BoletoCheckoutStarter({ onStart }: { onStart: () => void }) {
  useMountEffect(() => {
    onStart()
  })

  return null
}

function BoletoSuccessNotifier({
  subscriptionId,
  onSuccess,
}: {
  subscriptionId: number
  onSuccess: (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => void
}) {
  useMountEffect(() => {
    onSuccess(subscriptionId)
  })

  return null
}
