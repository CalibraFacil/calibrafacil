import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PLAN_PRICES, formatPrice } from '@calibra-facil/shared'

import type { BillingCycle, PlanId } from '@calibra-facil/shared'

import type { CheckoutState } from './checkout-dialog'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/utils/api'

interface BoletoPaymentProps {
  planId: PlanId
  cycle: BillingCycle
  onSuccess: (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => void
  onBack: () => void
}

// Type for boleto data from API (can have identificationField or not)
interface BoletoData {
  bankSlipUrl?: string
  barCode?: string
  identificationField?: string
  dueDate?: string
}

export function BoletoPayment({
  planId,
  cycle,
  onSuccess,
  onBack,
}: BoletoPaymentProps) {
  const [subscriptionId, setSubscriptionId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const prices = PLAN_PRICES[planId as Exclude<PlanId, 'FREE'>]
  const price = cycle === 'MONTHLY' ? prices?.monthly : prices?.yearly

  // Create subscription with Boleto
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const response = await api.api.billing.checkout.boleto.$post({
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

      const response = await api.api.billing.checkout.status[
        ':subscriptionId'
      ].$get({
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

  // Handle payment confirmation
  useEffect(() => {
    if (statusQuery.data?.status === 'ACTIVE' && subscriptionId) {
      onSuccess(subscriptionId)
    }
  }, [statusQuery.data?.status, subscriptionId, onSuccess])

  // Auto-initiate checkout
  useEffect(() => {
    if (!subscriptionId && !checkoutMutation.isPending) {
      checkoutMutation.mutate()
    }
  }, [])

  // Get boleto data with proper typing
  const boletoData = checkoutMutation.data?.boleto as
    | BoletoData
    | null
    | undefined

  const handleCopyBarcode = async () => {
    const barcode = boletoData?.identificationField
    if (barcode) {
      await navigator.clipboard.writeText(barcode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Loading state
  if (checkoutMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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
    <div className="space-y-6">
      {/* Boleto Info */}
      <div className="flex flex-col items-center space-y-4">
        <div className="text-center">
          <p className="text-lg font-medium">Boleto gerado com sucesso</p>
          <p className="text-2xl font-bold text-primary">
            {formatPrice(price || 0)}
          </p>
        </div>

        {/* Barcode Image - placeholder visual */}
        <div className="w-full rounded-lg border bg-white p-6">
          <div className="flex flex-col items-center space-y-4">
            {/* Barcode visual representation */}
            <div className="flex h-16 w-full items-center justify-center space-x-0.5">
              {Array.from({ length: 50 }).map((_, i) => (
                <div
                  key={i}
                  className="h-full bg-black"
                  style={{
                    width: Math.random() > 0.5 ? '2px' : '1px',
                    marginRight: Math.random() > 0.7 ? '2px' : '1px',
                  }}
                />
              ))}
            </div>

            {/* Linha digitavel */}
            {boletoData?.identificationField && (
              <p className="text-center font-mono text-sm">
                {boletoData.identificationField}
              </p>
            )}
          </div>
        </div>

        {/* Copy barcode */}
        {boletoData?.identificationField && (
          <Button
            variant="outline"
            onClick={handleCopyBarcode}
            className="w-full"
          >
            {copied ? 'Copiado!' : 'Copiar linha digitavel'}
          </Button>
        )}

        {/* Download PDF */}
        {boletoData?.bankSlipUrl && (
          <Button
            variant="default"
            className="w-full"
            onClick={() => window.open(boletoData.bankSlipUrl, '_blank')}
          >
            Baixar PDF do Boleto
          </Button>
        )}

        {/* Due date */}
        {boletoData?.dueDate && (
          <p className="text-sm text-muted-foreground">
            Vencimento:{' '}
            {new Date(boletoData.dueDate).toLocaleDateString('pt-BR')}
          </p>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-lg bg-muted p-4 text-sm">
        <p className="font-medium mb-2">Instrucoes:</p>
        <ul className="space-y-1 text-muted-foreground">
          <li>1. Copie a linha digitavel ou baixe o PDF</li>
          <li>2. Pague em qualquer banco ou app de pagamentos</li>
          <li>
            3. O pagamento pode levar ate 3 dias uteis para ser confirmado
          </li>
          <li>4. Voce recebera um email quando o pagamento for confirmado</li>
        </ul>
      </div>

      {/* Status */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        <span className="text-muted-foreground">Aguardando pagamento...</span>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            onSuccess(subscriptionId!, { boleto: boletoData ?? undefined })
          }
        >
          Concluir
        </Button>
      </div>
    </div>
  )
}
