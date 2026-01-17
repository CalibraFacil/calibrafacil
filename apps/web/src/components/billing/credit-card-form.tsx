import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { BillingCycle, PlanId } from '@calibra-facil/shared'
import { formatPrice, PLAN_PRICES } from '@calibra-facil/shared'
import type { CheckoutState } from './checkout-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { api } from '@/utils/api'
import { CreditCardDisplay, type CardBrand } from './credit-card-display'
import { SlideToPayButton } from './slide-to-pay-button'

interface CreditCardFormProps {
  planId: PlanId
  cycle: BillingCycle
  onSuccess: (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => void
  onBack?: () => void
}

interface CardFormData {
  holderName: string
  number: string
  expiry: string // Combined MM/AA format
  ccv: string
  cpfCnpj: string
  email: string
  phone: string
  postalCode: string
  addressNumber: string
}

// Card brand detection
function detectCardBrand(number: string): CardBrand {
  const cleanNumber = number.replace(/\s/g, '')
  if (/^4/.test(cleanNumber)) return 'visa'
  if (/^5[1-5]/.test(cleanNumber)) return 'mastercard'
  if (/^3[47]/.test(cleanNumber)) return 'amex'
  if (/^(636368|438935|504175|451416|636297)/.test(cleanNumber)) return 'elo'
  return 'unknown'
}

// Format card number with spaces
function formatCardNumber(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{4})/g, '$1 ')
    .trim()
    .slice(0, 19)
}

// Format expiry as MM/AA
function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length >= 2) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }
  return digits
}

// Parse expiry into month and year
function parseExpiry(expiry: string): { month: string; year: string } {
  const parts = expiry.split('/')
  return {
    month: parts[0] || '',
    year: parts[1] ? `20${parts[1]}` : '',
  }
}

// Format CPF/CNPJ
function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  } else {
    // CNPJ: 00.000.000/0000-00
    return digits
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }
}

// Format phone
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  } else {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2')
  }
}

// Format CEP
function formatCep(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 8)
    .replace(/(\d{5})(\d)/, '$1-$2')
}

export function CreditCardForm({
  planId,
  cycle,
  onSuccess,
}: CreditCardFormProps) {
  const [formData, setFormData] = useState<CardFormData>({
    holderName: '',
    number: '',
    expiry: '',
    ccv: '',
    cpfCnpj: '',
    email: '',
    phone: '',
    postalCode: '',
    addressNumber: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isCardFlipped, setIsCardFlipped] = useState(false)

  const prices = PLAN_PRICES[planId as Exclude<PlanId, 'FREE'>]
  const price = cycle === 'MONTHLY' ? prices?.monthly : prices?.yearly
  const cardBrand = detectCardBrand(formData.number)

  const checkoutMutation = useMutation({
    mutationFn: async (data: CardFormData) => {
      const { month, year } = parseExpiry(data.expiry)

      const cardHolder = {
        name: data.holderName,
        cpfCnpj: data.cpfCnpj.replace(/\D/g, ''),
        email: data.email,
        phone: data.phone.replace(/\D/g, ''),
        postalCode: data.postalCode.replace(/\D/g, ''),
        addressNumber: data.addressNumber,
      }

      // Step 1: Tokenize card data (PCI-DSS compliant)
      const tokenizeResponse = await api.api.billing.checkout.tokenize.$post({
        json: {
          creditCard: {
            holderName: data.holderName,
            number: data.number.replace(/\s/g, ''),
            expiryMonth: month,
            expiryYear: year,
            ccv: data.ccv,
          },
          cardHolder,
        },
      })

      if (!tokenizeResponse.ok) {
        const error = await tokenizeResponse.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao processar cartão',
        )
      }

      const tokenData = await tokenizeResponse.json()

      // Step 2: Create subscription using token (no raw card data)
      const response = await api.api.billing.checkout['credit-card'].$post({
        json: {
          planId: planId as Exclude<PlanId, 'FREE'>,
          cycle,
          creditCardToken: tokenData.creditCardToken,
          cardHolder,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao processar pagamento',
        )
      }

      return response.json()
    },
    onSuccess: (data) => {
      onSuccess(data.subscription.id)
    },
  })

  const handleChange =
    (field: keyof CardFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let value = e.target.value

      // Apply formatters
      if (field === 'number') {
        value = formatCardNumber(value)
      } else if (field === 'expiry') {
        value = formatExpiry(value)
      } else if (field === 'cpfCnpj') {
        value = formatCpfCnpj(value)
      } else if (field === 'phone') {
        value = formatPhone(value)
      } else if (field === 'postalCode') {
        value = formatCep(value)
      } else if (field === 'ccv') {
        value = value.replace(/\D/g, '').slice(0, 4)
      } else if (field === 'holderName') {
        value = value.toUpperCase()
      }

      setFormData((prev) => ({ ...prev, [field]: value }))
      // Clear error when user types
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: '' }))
      }
    }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    const { month, year } = parseExpiry(formData.expiry)

    // Card number
    const cleanCardNumber = formData.number.replace(/\s/g, '')
    if (!cleanCardNumber || cleanCardNumber.length < 13) {
      newErrors.number = 'Número do cartão inválido'
    }

    // Expiry
    if (!month || !year || month.length !== 2 || year.length !== 4) {
      newErrors.expiry = 'Data inválida'
    } else {
      const monthNum = parseInt(month, 10)
      if (monthNum < 1 || monthNum > 12) {
        newErrors.expiry = 'Mês inválido'
      }
    }

    // CVV
    if (!formData.ccv || formData.ccv.length < 3) {
      newErrors.ccv = 'CVV inválido'
    }

    // Holder name
    if (!formData.holderName || formData.holderName.trim().length < 3) {
      newErrors.holderName = 'Nome obrigatório'
    }

    // CPF/CNPJ
    const cleanCpfCnpj = formData.cpfCnpj.replace(/\D/g, '')
    if (!cleanCpfCnpj || cleanCpfCnpj.length < 11) {
      newErrors.cpfCnpj = 'CPF/CNPJ inválido'
    }

    // Email
    if (!formData.email || !formData.email.includes('@')) {
      newErrors.email = 'Email inválido'
    }

    // Phone
    const cleanPhone = formData.phone.replace(/\D/g, '')
    if (!cleanPhone || cleanPhone.length < 10) {
      newErrors.phone = 'Telefone inválido'
    }

    // CEP
    const cleanCep = formData.postalCode.replace(/\D/g, '')
    if (!cleanCep || cleanCep.length !== 8) {
      newErrors.postalCode = 'CEP inválido'
    }

    // Address number
    if (!formData.addressNumber || formData.addressNumber.trim().length === 0) {
      newErrors.addressNumber = 'Número obrigatório'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    checkoutMutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Credit Card Display */}
      <CreditCardDisplay
        cardNumber={formData.number}
        cardHolder={formData.holderName}
        expiryDate={formData.expiry}
        cvv={formData.ccv}
        cardBrand={cardBrand}
        isFlipped={isCardFlipped}
      />

      {/* Card Number */}
      <div className="space-y-2">
        <Label htmlFor="number">Número do Cartão</Label>
        <Input
          id="number"
          type="text"
          inputMode="numeric"
          placeholder="0000 0000 0000 0000"
          value={formData.number}
          onChange={handleChange('number')}
          onFocus={() => setIsCardFlipped(false)}
          maxLength={19}
          className={cn(errors.number && 'border-destructive')}
          disabled={checkoutMutation.isPending}
        />
        {errors.number && (
          <p className="text-xs text-destructive">{errors.number}</p>
        )}
      </div>

      {/* Expiry and CVV */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="expiry">Validade</Label>
          <Input
            id="expiry"
            type="text"
            inputMode="numeric"
            placeholder="MM/AA"
            value={formData.expiry}
            onChange={handleChange('expiry')}
            onFocus={() => setIsCardFlipped(false)}
            maxLength={5}
            className={cn(errors.expiry && 'border-destructive')}
            disabled={checkoutMutation.isPending}
          />
          {errors.expiry && (
            <p className="text-xs text-destructive">{errors.expiry}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ccv">CVV</Label>
          <Input
            id="ccv"
            type="text"
            inputMode="numeric"
            placeholder="000"
            value={formData.ccv}
            onChange={handleChange('ccv')}
            onFocus={() => setIsCardFlipped(true)}
            onBlur={() => setIsCardFlipped(false)}
            maxLength={4}
            className={cn(errors.ccv && 'border-destructive')}
            disabled={checkoutMutation.isPending}
          />
          {errors.ccv && (
            <p className="text-xs text-destructive">{errors.ccv}</p>
          )}
        </div>
      </div>

      {/* Cardholder Name */}
      <div className="space-y-2">
        <Label htmlFor="holderName">Nome no Cartão</Label>
        <Input
          id="holderName"
          type="text"
          placeholder="NOME COMO NO CARTÃO"
          value={formData.holderName}
          onChange={handleChange('holderName')}
          onFocus={() => setIsCardFlipped(false)}
          className={cn(errors.holderName && 'border-destructive')}
          disabled={checkoutMutation.isPending}
        />
        {errors.holderName && (
          <p className="text-xs text-destructive">{errors.holderName}</p>
        )}
      </div>

      {/* CPF/CNPJ and Phone */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cpfCnpj">CPF ou CNPJ</Label>
          <Input
            id="cpfCnpj"
            type="text"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={formData.cpfCnpj}
            onChange={handleChange('cpfCnpj')}
            maxLength={18}
            className={cn(errors.cpfCnpj && 'border-destructive')}
            disabled={checkoutMutation.isPending}
          />
          {errors.cpfCnpj && (
            <p className="text-xs text-destructive">{errors.cpfCnpj}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            type="text"
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={formData.phone}
            onChange={handleChange('phone')}
            maxLength={15}
            className={cn(errors.phone && 'border-destructive')}
            disabled={checkoutMutation.isPending}
          />
          {errors.phone && (
            <p className="text-xs text-destructive">{errors.phone}</p>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="email@exemplo.com"
          value={formData.email}
          onChange={handleChange('email')}
          className={cn(errors.email && 'border-destructive')}
          disabled={checkoutMutation.isPending}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email}</p>
        )}
      </div>

      {/* CEP and Address Number */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalCode">CEP</Label>
          <Input
            id="postalCode"
            type="text"
            inputMode="numeric"
            placeholder="00000-000"
            value={formData.postalCode}
            onChange={handleChange('postalCode')}
            maxLength={9}
            className={cn(errors.postalCode && 'border-destructive')}
            disabled={checkoutMutation.isPending}
          />
          {errors.postalCode && (
            <p className="text-xs text-destructive">{errors.postalCode}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="addressNumber">Número</Label>
          <Input
            id="addressNumber"
            type="text"
            placeholder="123"
            value={formData.addressNumber}
            onChange={handleChange('addressNumber')}
            className={cn(errors.addressNumber && 'border-destructive')}
            disabled={checkoutMutation.isPending}
          />
          {errors.addressNumber && (
            <p className="text-xs text-destructive">{errors.addressNumber}</p>
          )}
        </div>
      </div>

      {/* Error Message */}
      {checkoutMutation.isError && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {checkoutMutation.error instanceof Error
            ? checkoutMutation.error.message
            : 'Erro ao processar pagamento'}
        </div>
      )}

      {/* Slide to Pay Button */}
      <SlideToPayButton
        onComplete={() => {
          if (validate()) {
            checkoutMutation.mutate(formData)
          }
        }}
        disabled={checkoutMutation.isPending}
        isLoading={checkoutMutation.isPending}
        price={formatPrice(price || 0)}
      />

      {/* Security Note */}
      <p className="text-center text-xs text-muted-foreground">
        Pagamento processado com segurança via Asaas
      </p>
    </form>
  )
}
