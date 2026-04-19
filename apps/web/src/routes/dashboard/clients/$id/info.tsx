import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { formatMoney } from '@calibra-facil/shared'
import { api } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { clientRouteId } from '@/lib/route-identifiers'

export const Route = createFileRoute('/dashboard/clients/$id/info')({
  component: ClientInfoTab,
})

type CustomerAddress = {
  cep?: string
  number?: string
  street?: string
  neighbourhood?: string
  city?: string
  state?: string
}

type CustomerFinancialSummary = {
  openDocumentsCount: number
  overdueDocumentsCount: number
  openBalanceCents: number
  overdueBalanceCents: number
  overdueBalanceFlag: boolean
}

function ClientInfoTab() {
  const { id } = useParams({ from: '/dashboard/clients/$id/info' })

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const res = await api.api.customers[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar cliente')
      }
      return res.json() as Promise<{
        id: number
        name?: string
        taxId?: string
        email?: string
        phone?: string
        address?: CustomerAddress
        financialSummary?: CustomerFinancialSummary
      }>
    },
  })

  if (isLoading) {
    return <InfoSkeleton />
  }

  if (!customer) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cliente não encontrado
        </CardContent>
      </Card>
    )
  }

  return (
    <ClientInfoForm key={customer.id} customer={customer} customerId={id} />
  )
}

function ClientInfoForm({
  customer,
  customerId,
}: {
  customer: {
    id: number
    name?: string
    taxId?: string
    email?: string
    phone?: string
    address?: CustomerAddress
    financialSummary?: CustomerFinancialSummary
  }
  customerId: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [addressOpen, setAddressOpen] = useState(false)

  const [name, setName] = useState(customer.name || '')
  const [taxId, setTaxId] = useState(customer.taxId || '')
  const [email, setEmail] = useState(customer.email || '')
  const [phone, setPhone] = useState(customer.phone || '')
  const [address, setAddress] = useState<CustomerAddress>(
    customer.address || {},
  )
  const [formError, setFormError] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: async (data: {
      name?: string
      taxId?: string
      email?: string
      phone?: string
      address?: CustomerAddress
    }) => {
      const res = await api.api.customers[':id'].$put({
        param: { id: customerId },
        json: data,
      })
      if (!res.ok) {
        throw new Error('Falha ao atualizar cliente')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Cliente atualizado com sucesso!')
      navigate({
        to: '/dashboard/clients/$id/info',
        params: {
          id: clientRouteId({
            name: name.trim(),
            taxId: taxId.trim() || null,
          }),
        },
      })
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar cliente')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!name.trim()) {
      setFormError('Nome e obrigatorio')
      return
    }

    const hasAddressData = Object.values(address).some(
      (v) => typeof v === 'string' && v.trim() !== '',
    )

    updateMutation.mutate({
      name: name.trim(),
      taxId: taxId.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: hasAddressData ? address : undefined,
    })
  }

  const updateAddress = (field: keyof CustomerAddress, value: string) => {
    setAddress((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Resumo financeiro</CardTitle>
          <CardDescription>
            Contexto operacional de aberto e vencido para atendimento e gestão
            comercial.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryItem
            label="Documentos em aberto"
            value={String(customer.financialSummary?.openDocumentsCount ?? 0)}
          />
          <SummaryItem
            label="Documentos vencidos"
            value={String(
              customer.financialSummary?.overdueDocumentsCount ?? 0,
            )}
          />
          <SummaryItem
            label="Saldo em aberto"
            value={formatMoney(
              customer.financialSummary?.openBalanceCents ?? 0,
            )}
          />
          <SummaryItem
            label="Saldo vencido"
            value={formatMoney(
              customer.financialSummary?.overdueBalanceCents ?? 0,
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Informações do Cliente</CardTitle>
          <CardDescription>
            Dados cadastrais e informações de contato.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Nome / Razão Social</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setFormError(null)
                  }}
                  disabled={updateMutation.isPending}
                  placeholder="Nome da empresa ou pessoa"
                />
                {formError && <FieldError>{formError}</FieldError>}
              </Field>

              <Field>
                <FieldLabel htmlFor="taxId">CNPJ / CPF</FieldLabel>
                <Input
                  id="taxId"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  disabled={updateMutation.isPending}
                  placeholder="00.000.000/0000-00"
                />
                <FieldDescription>
                  Documento de identificação fiscal.
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={updateMutation.isPending}
                    placeholder="contato@empresa.com"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="phone">Telefone</FieldLabel>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={updateMutation.isPending}
                    placeholder="(11) 99999-9999"
                  />
                </Field>
              </div>

              <Collapsible open={addressOpen} onOpenChange={setAddressOpen}>
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      type="button"
                      className="flex w-full items-center justify-between px-0 hover:bg-transparent"
                    />
                  }
                >
                  <span className="text-sm font-medium">Endereço</span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    className={`size-4 transition-transform ${addressOpen ? 'rotate-180' : ''}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="cep">CEP</FieldLabel>
                      <Input
                        id="cep"
                        value={address.cep || ''}
                        onChange={(e) => updateAddress('cep', e.target.value)}
                        disabled={updateMutation.isPending}
                        placeholder="00000-000"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="number">Número</FieldLabel>
                      <Input
                        id="number"
                        value={address.number || ''}
                        onChange={(e) =>
                          updateAddress('number', e.target.value)
                        }
                        disabled={updateMutation.isPending}
                        placeholder="123"
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="street">Rua</FieldLabel>
                    <Input
                      id="street"
                      value={address.street || ''}
                      onChange={(e) => updateAddress('street', e.target.value)}
                      disabled={updateMutation.isPending}
                      placeholder="Nome da rua"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="neighbourhood">Bairro</FieldLabel>
                    <Input
                      id="neighbourhood"
                      value={address.neighbourhood || ''}
                      onChange={(e) =>
                        updateAddress('neighbourhood', e.target.value)
                      }
                      disabled={updateMutation.isPending}
                      placeholder="Nome do bairro"
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="city">Cidade</FieldLabel>
                      <Input
                        id="city"
                        value={address.city || ''}
                        onChange={(e) => updateAddress('city', e.target.value)}
                        disabled={updateMutation.isPending}
                        placeholder="São Paulo"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="state">Estado</FieldLabel>
                      <Input
                        id="state"
                        value={address.state || ''}
                        onChange={(e) => updateAddress('state', e.target.value)}
                        disabled={updateMutation.isPending}
                        placeholder="SP"
                        maxLength={2}
                      />
                    </Field>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending
                    ? 'Salvando...'
                    : 'Salvar alterações'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 font-medium">{value}</div>
    </div>
  )
}

function InfoSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-9 w-32" />
        </div>
      </CardContent>
    </Card>
  )
}
