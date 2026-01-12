import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { BillingCycle, PlanId } from '@calibra-facil/shared'
import type { CheckoutState } from './checkout-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/utils/api'

interface CreditCardFormProps {
  planId: PlanId
  cycle: BillingCycle
  onSuccess: (
    subscriptionId: number,
    paymentData?: CheckoutState['paymentData'],
  ) => void
  onBack: () => void
}

interface CardFormData {
  holderName: string
  number: string
  expiryMonth: string
  expiryYear: string
  ccv: string
  cpfCnpj: string
  email: string
  phone: string
  postalCode: string
  addressNumber: string
}

export function CreditCardForm({
  planId,
  cycle,
  onSuccess,
  onBack,
}: CreditCardFormProps) {
  const [formData, setFormData] = useState<CardFormData>({
    holderName: '',
    number: '',
    expiryMonth: '',
    expiryYear: '',
    ccv: '',
    cpfCnpj: '',
    email: '',
    phone: '',
    postalCode: '',
    addressNumber: '',
  })

  const checkoutMutation = useMutation({
    mutationFn: async (data: CardFormData) => {
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
            expiryMonth: data.expiryMonth,
            expiryYear: data.expiryYear,
            ccv: data.ccv,
          },
          cardHolder,
        },
      })

      if (!tokenizeResponse.ok) {
        const error = await tokenizeResponse.json()
        throw new Error(
          (error as { error?: string }).error ||
            'Erro ao processar cartão',
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
          (error as { error?: string }).error ||
            'Erro ao processar pagamento',
        )
      }

      return response.json()
    },
    onSuccess: (data) => {
      onSuccess(data.subscription.id)
    },
  })

  const handleChange =
    (field: keyof CardFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
      let value = e.target.value

      // Format card number with spaces
      if (field === 'number') {
        value = value
          .replace(/\D/g, '')
          .replace(/(\d{4})/g, '$1 ')
          .trim()
          .slice(0, 19)
      }

      // Format CPF/CNPJ
      if (field === 'cpfCnpj') {
        value = value.replace(/\D/g, '').slice(0, 14)
        if (value.length <= 11) {
          // CPF: 000.000.000-00
          value = value
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
        } else {
          // CNPJ: 00.000.000/0000-00
          value = value
            .replace(/(\d{2})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1/$2')
            .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
        }
      }

      // Format phone
      if (field === 'phone') {
        value = value.replace(/\D/g, '').slice(0, 11)
        if (value.length <= 10) {
          value = value
            .replace(/(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{4})(\d)/, '$1-$2')
        } else {
          value = value
            .replace(/(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{5})(\d)/, '$1-$2')
        }
      }

      // Format CEP
      if (field === 'postalCode') {
        value = value
          .replace(/\D/g, '')
          .slice(0, 8)
          .replace(/(\d{5})(\d)/, '$1-$2')
      }

      // Limit expiry fields
      if (field === 'expiryMonth') {
        value = value.replace(/\D/g, '').slice(0, 2)
      }
      if (field === 'expiryYear') {
        value = value.replace(/\D/g, '').slice(0, 4)
      }
      if (field === 'ccv') {
        value = value.replace(/\D/g, '').slice(0, 4)
      }

      setFormData((prev) => ({ ...prev, [field]: value }))
    }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    checkoutMutation.mutate(formData)
  }

  const isFormValid =
    formData.holderName.length >= 3 &&
    formData.number.replace(/\s/g, '').length >= 13 &&
    formData.expiryMonth.length === 2 &&
    formData.expiryYear.length === 4 &&
    formData.ccv.length >= 3 &&
    formData.cpfCnpj.replace(/\D/g, '').length >= 11 &&
    formData.email.includes('@') &&
    formData.phone.replace(/\D/g, '').length >= 10 &&
    formData.postalCode.replace(/\D/g, '').length === 8 &&
    formData.addressNumber.length > 0

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {checkoutMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {checkoutMutation.error instanceof Error
              ? checkoutMutation.error.message
              : 'Erro ao processar pagamento'}
          </AlertDescription>
        </Alert>
      )}

      {/* Card Details */}
      <div className="space-y-4">
        <h3 className="font-medium">Dados do Cartao</h3>

        <div className="space-y-2">
          <Label htmlFor="holderName">Nome no cartão</Label>
          <Input
            id="holderName"
            placeholder="JOAO M SILVA"
            value={formData.holderName}
            onChange={handleChange('holderName')}
            className="uppercase"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="number">Número do cartão</Label>
          <Input
            id="number"
            placeholder="0000 0000 0000 0000"
            value={formData.number}
            onChange={handleChange('number')}
            inputMode="numeric"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="expiryMonth">Mês</Label>
            <Input
              id="expiryMonth"
              placeholder="MM"
              value={formData.expiryMonth}
              onChange={handleChange('expiryMonth')}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expiryYear">Ano</Label>
            <Input
              id="expiryYear"
              placeholder="AAAA"
              value={formData.expiryYear}
              onChange={handleChange('expiryYear')}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ccv">CVV</Label>
            <Input
              id="ccv"
              placeholder="000"
              value={formData.ccv}
              onChange={handleChange('ccv')}
              inputMode="numeric"
            />
          </div>
        </div>
      </div>

      {/* Holder Info */}
      <div className="space-y-4 border-t pt-4">
        <h3 className="font-medium">Dados do Titular</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="cpfCnpj">CPF/CNPJ</Label>
            <Input
              id="cpfCnpj"
              placeholder="000.000.000-00"
              value={formData.cpfCnpj}
              onChange={handleChange('cpfCnpj')}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              placeholder="(00) 00000-0000"
              value={formData.phone}
              onChange={handleChange('phone')}
              inputMode="tel"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="email@exemplo.com"
            value={formData.email}
            onChange={handleChange('email')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="postalCode">CEP</Label>
            <Input
              id="postalCode"
              placeholder="00000-000"
              value={formData.postalCode}
              onChange={handleChange('postalCode')}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="addressNumber">Número</Label>
            <Input
              id="addressNumber"
              placeholder="123"
              value={formData.addressNumber}
              onChange={handleChange('addressNumber')}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={checkoutMutation.isPending}
        >
          Voltar
        </Button>
        <Button
          type="submit"
          disabled={!isFormValid || checkoutMutation.isPending}
        >
          {checkoutMutation.isPending ? 'Processando...' : 'Pagar'}
        </Button>
      </div>
    </form>
  )
}
