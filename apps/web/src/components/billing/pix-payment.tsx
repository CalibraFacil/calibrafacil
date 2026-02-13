import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon, Loading03Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { api } from '@/utils/api'
import {
  formatPrice,
  PLAN_PRICES,
  type PlanId,
  type BillingCycle,
} from '@calibra-facil/shared'
import type { CheckoutState } from './checkout-dialog'

interface PixPaymentProps {
  planId: PlanId
  cycle: BillingCycle
  onSuccess: (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => void
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
  const [timeRemaining, setTimeRemaining] = useState<string>('')

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
          (error as { message?: string }).message || 'Erro ao gerar PIX',
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
      // Stop polling when payment is confirmed
      if (data?.isActive || data?.isPaid) return false
      return 5000 // Poll every 5 seconds for PIX
    },
  })

  const isPaid = statusQuery.data?.isActive || statusQuery.data?.isPaid

  // Handle payment confirmation
  useEffect(() => {
    if (isPaid && subscriptionId) {
      onSuccess(subscriptionId)
    }
  }, [isPaid, subscriptionId, onSuccess])

  // Auto-initiate checkout
  useEffect(() => {
    if (!subscriptionId && !checkoutMutation.isPending) {
      checkoutMutation.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Countdown timer
  useEffect(() => {
    const expirationDate = checkoutMutation.data?.pix?.expirationDate
    if (!expirationDate) return

    const updateTimer = () => {
      const expiration = new Date(expirationDate)
      const now = new Date()
      const diff = expiration.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeRemaining('Expirado')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`)
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s`)
      } else {
        setTimeRemaining(`${seconds}s`)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [checkoutMutation.data?.pix?.expirationDate])

  const handleCopy = async () => {
    if (checkoutMutation.data?.pix?.payload) {
      try {
        await navigator.clipboard.writeText(checkoutMutation.data.pix.payload)
        setCopied(true)
        toast.success('Código copiado!')
        setTimeout(() => setCopied(false), 2000)
      } catch {
        toast.error('Erro ao copiar código')
      }
    }
  }

  // Loading state
  if (checkoutMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-10 animate-spin text-primary"
        />
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
    <div className="flex flex-col items-center gap-6">
      {/* QR Code */}
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">Escaneie o QR Code</p>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-foreground/10">
          {pixData?.qrCodeImage ? (
            <img
              src={pixData.qrCodeImage}
              alt="PIX QR Code"
              className="size-48"
            />
          ) : (
            <div className="flex size-48 items-center justify-center bg-muted">
              <p className="text-muted-foreground">QR Code</p>
            </div>
          )}
        </div>
      </div>

      {/* Value */}
      <div className="text-center">
        <p className="text-2xl font-semibold">{formatPrice(price || 0)}</p>
      </div>

      {/* Copy Code */}
      {pixData?.payload && (
        <div className="w-full space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            Ou copie o código PIX
          </p>
          <div className="flex gap-2">
            <div className="flex-1 truncate rounded-lg bg-muted p-3 font-mono text-xs">
              {pixData.payload.slice(0, 40)}...
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              className="shrink-0"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                className="size-4"
              />
            </Button>
          </div>
        </div>
      )}

      {/* Timer */}
      {timeRemaining && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Expira em:</span>
          <span className="font-medium text-foreground">{timeRemaining}</span>
        </div>
      )}

      {/* Waiting Status */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
        <span>Aguardando pagamento...</span>
      </div>
    </div>
  )
}
