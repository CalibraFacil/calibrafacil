import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/utils/api'
import { formatPrice, PLAN_PRICES, type PlanId, type BillingCycle } from '@calibra-facil/shared'
import type { CheckoutState } from './checkout-dialog'

interface PixPaymentProps {
  planId: PlanId
  cycle: BillingCycle
  onSuccess: (subscriptionId: number, paymentData?: CheckoutState['paymentData']) => void
  onBack: () => void
}

export function PixPayment({
  planId,
  cycle,
  onSuccess,
  onBack,
}: PixPaymentProps) {
  const [subscriptionId, setSubscriptionId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const prices = PLAN_PRICES[planId as Exclude<PlanId, 'FREE'>]
  const price = cycle === 'MONTHLY' ? prices?.monthly : prices?.yearly

  // Create subscription with PIX
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const response = await api.api.billing.checkout.pix.$post({
        json: {
          planId: planId as Exclude<PlanId, 'FREE'>,
          cycle,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(
          (error as { message?: string }).message || 'Erro ao gerar PIX'
        )
      }

      return response.json()
    },
    onSuccess: (data) => {
      setSubscriptionId(data.subscriptionId)
    },
  })

  // Poll for payment status
  const statusQuery = useQuery({
    queryKey: ['checkout-status', subscriptionId],
    queryFn: async () => {
      if (!subscriptionId) return null

      const response = await api.api.billing.checkout.status[':subscriptionId'].$get({
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
      // Stop polling when payment is confirmed
      if (data?.isActive || data?.isPaid) return false
      return 3000 // Poll every 3 seconds
    },
  })

  // Handle payment confirmation
  useEffect(() => {
    const data = statusQuery.data
    if ((data?.isActive || data?.isPaid) && subscriptionId) {
      onSuccess(subscriptionId)
    }
  }, [statusQuery.data?.isActive, statusQuery.data?.isPaid, subscriptionId, onSuccess])

  // Auto-initiate checkout
  useEffect(() => {
    if (!subscriptionId && !checkoutMutation.isPending) {
      checkoutMutation.mutate()
    }
  }, [])

  const handleCopyPayload = async () => {
    if (checkoutMutation.data?.pix?.payload) {
      await navigator.clipboard.writeText(checkoutMutation.data.pix.payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Loading state
  if (checkoutMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Gerando QR Code PIX...</p>
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
              : 'Erro ao gerar PIX'}
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

  const pixData = checkoutMutation.data?.pix

  return (
    <div className="space-y-6">
      {/* QR Code */}
      <div className="flex flex-col items-center space-y-4">
        <div className="text-center">
          <p className="text-lg font-medium">Escaneie o QR Code para pagar</p>
          <p className="text-2xl font-bold text-primary">
            {formatPrice(price || 0)}
          </p>
        </div>

        {pixData?.qrCodeImage ? (
          <div className="rounded-lg border bg-white p-4">
            <img
              src={pixData.qrCodeImage}
              alt="QR Code PIX"
              className="h-48 w-48"
            />
          </div>
        ) : (
          <div className="flex h-48 w-48 items-center justify-center rounded-lg border bg-muted">
            <p className="text-muted-foreground">QR Code</p>
          </div>
        )}

        {/* Copy Payload */}
        {pixData?.payload && (
          <div className="w-full space-y-2">
            <p className="text-center text-sm text-muted-foreground">
              Ou copie o codigo PIX Copia e Cola
            </p>
            <div className="flex gap-2">
              <div className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-sm">
                {pixData.payload}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyPayload}
                className="shrink-0"
              >
                {copied ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
          </div>
        )}

        {/* Expiration */}
        {pixData?.expirationDate && (
          <p className="text-xs text-muted-foreground">
            Valido ate: {new Date(pixData.expirationDate).toLocaleString('pt-BR')}
          </p>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        <span className="text-muted-foreground">Aguardando pagamento...</span>
      </div>

      {/* Actions */}
      <div className="flex justify-start pt-2">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  )
}
