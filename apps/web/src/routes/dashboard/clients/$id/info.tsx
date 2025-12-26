import { createFileRoute, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
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

function ClientInfoTab() {
  const { id } = useParams({ from: '/dashboard/clients/$id/info' })
  const queryClient = useQueryClient()
  const [addressOpen, setAddressOpen] = useState(false)

  const [name, setName] = useState('')
  const [taxId, setTaxId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState<CustomerAddress>({})
  const [formError, setFormError] = useState<string | null>(null)

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const res = await api.api.customers[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar cliente')
      }
      return res.json()
    },
  })

  // Populate form when customer data loads
  useEffect(() => {
    if (customer) {
      setName(customer.name || '')
      setTaxId(customer.taxId || '')
      setEmail(customer.email || '')
      setPhone(customer.phone || '')
      setAddress(customer.address || {})
    }
  }, [customer])

  const updateMutation = useMutation({
    mutationFn: async (data: {
      name?: string
      taxId?: string
      email?: string
      phone?: string
      address?: CustomerAddress
    }) => {
      const res = await api.api.customers[':id'].$put({
        param: { id },
        json: data,
      })
      if (!res.ok) {
        throw new Error('Falha ao atualizar cliente')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Cliente atualizado com sucesso!')
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar cliente')
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
                      onChange={(e) => updateAddress('number', e.target.value)}
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
                {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
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
