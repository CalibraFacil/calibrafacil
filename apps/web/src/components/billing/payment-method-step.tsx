import { HugeiconsIcon } from '@hugeicons/react'
import {
  CreditCardIcon,
  Invoice01Icon,
  QrCodeIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { PaymentMethodType } from './checkout-dialog'

interface PaymentMethodOption {
  id: PaymentMethodType
  name: string
  description: string
  icon: typeof CreditCardIcon
}

const PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: 'CREDIT_CARD',
    name: 'Cartão de Crédito',
    description: 'Pagamento imediato',
    icon: CreditCardIcon,
  },
  {
    id: 'PIX',
    name: 'PIX',
    description: 'Aprovação instantânea',
    icon: QrCodeIcon,
  },
  {
    id: 'BOLETO',
    name: 'Boleto',
    description: 'Vencimento em 3 dias',
    icon: Invoice01Icon,
  },
]

interface PaymentMethodStepProps {
  onSelect: (method: PaymentMethodType) => void
}

export function PaymentMethodStep({ onSelect }: PaymentMethodStepProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {PAYMENT_METHODS.map((method) => (
        <button
          key={method.id}
          type="button"
          onClick={() => onSelect(method.id)}
          className={cn(
            'group flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-all',
            'hover:border-primary/50 hover:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            'border-border',
          )}
        >
          <div
            className={cn(
              'flex size-12 items-center justify-center rounded-full transition-colors',
              'bg-muted group-hover:bg-primary/10',
            )}
          >
            <HugeiconsIcon
              icon={method.icon}
              className={cn(
                'size-6 transition-colors',
                'text-muted-foreground group-hover:text-primary',
              )}
            />
          </div>
          <div>
            <p className="font-medium">{method.name}</p>
            <p className="text-sm text-muted-foreground">{method.description}</p>
          </div>
        </button>
      ))}
    </div>
  )
}
