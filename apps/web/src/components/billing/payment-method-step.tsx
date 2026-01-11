import { HugeiconsIcon } from '@hugeicons/react'
import {
  CreditCardIcon,
  Invoice02Icon,
  QrCodeIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PaymentMethodType } from './checkout-dialog'

interface PaymentMethodStepProps {
  onSelect: (method: PaymentMethodType) => void
  onBack: () => void
}

const PAYMENT_METHODS = [
  {
    id: 'CREDIT_CARD' as const,
    name: 'Cartão de Crédito',
    description: 'Pagamento instantâneo com parcelamento',
    icon: CreditCardIcon,
  },
  {
    id: 'PIX' as const,
    name: 'PIX',
    description: 'Pagamento instantâneo via QR Code',
    icon: QrCodeIcon,
  },
  {
    id: 'BOLETO' as const,
    name: 'Boleto Bancario',
    description: 'Pagamento em até 3 dias úteis',
    icon: Invoice02Icon,
  },
]

export function PaymentMethodStep({
  onSelect,
  onBack,
}: PaymentMethodStepProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3">
        {PAYMENT_METHODS.map((method) => (
          <Card
            key={method.id}
            className="cursor-pointer transition-all hover:border-primary hover:shadow-sm"
            onClick={() => onSelect(method.id)}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon
                  icon={method.icon}
                  className="text-foreground"
                  size={24}
                />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">{method.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {method.description}
                </p>
              </div>
              <div className="text-muted-foreground">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M7.5 15L12.5 10L7.5 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-start">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  )
}
