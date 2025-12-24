import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown01Icon, ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export const Route = createFileRoute('/dashboard/clients/new')({
  head: () => ({
    meta: [{ title: 'Novo Cliente | CalibraFácil' }],
  }),
  component: NewClientPage,
})

interface FormData {
  name: string
  taxId: string
  email: string
  phone: string
  address: {
    cep: string
    street: string
    number: string
    neighbourhood: string
    city: string
    state: string
  }
}

const initialFormData: FormData = {
  name: '',
  taxId: '',
  email: '',
  phone: '',
  address: {
    cep: '',
    street: '',
    number: '',
    neighbourhood: '',
    city: '',
    state: '',
  },
}

function NewClientPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )
  const [addressOpen, setAddressOpen] = useState(false)

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.api.customers.$post({
        json: {
          name: data.name,
          taxId: data.taxId || undefined,
          email: data.email || undefined,
          phone: data.phone || undefined,
          address:
            data.address.cep || data.address.street || data.address.city
              ? {
                  cep: data.address.cep || undefined,
                  street: data.address.street || undefined,
                  number: data.address.number || undefined,
                  neighbourhood: data.address.neighbourhood || undefined,
                  city: data.address.city || undefined,
                  state: data.address.state || undefined,
                }
              : undefined,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar cliente',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Cliente e acesso ao portal criados com sucesso!')
      navigate({ to: '/dashboard/clients' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório'
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Nome deve ter pelo menos 2 caracteres'
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Email inválido'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    createMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateAddressField = (
    field: keyof FormData['address'],
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }))
  }

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/clients' })}
          className="mb-4"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo Cliente</CardTitle>
          <CardDescription>
            Cadastre um novo cliente. Se um email for informado, um convite para
            o portal do cliente será enviado automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {/* Name */}
              <Field>
                <FieldLabel htmlFor="name">Nome / Razão Social *</FieldLabel>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Nome da empresa ou pessoa"
                  disabled={createMutation.isPending}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              {/* Tax ID */}
              <Field>
                <FieldLabel htmlFor="taxId">CNPJ / CPF</FieldLabel>
                <Input
                  id="taxId"
                  value={formData.taxId}
                  onChange={(e) => updateField('taxId', e.target.value)}
                  placeholder="00.000.000/0000-00"
                  disabled={createMutation.isPending}
                />
              </Field>

              {/* Email */}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="contato@empresa.com"
                  disabled={createMutation.isPending}
                />
                <FieldDescription>
                  Se informado, o cliente receberá um convite para acessar o
                  portal.
                </FieldDescription>
                {errors.email && <FieldError>{errors.email}</FieldError>}
              </Field>

              {/* Phone */}
              <Field>
                <FieldLabel htmlFor="phone">Telefone</FieldLabel>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="(11) 99999-9999"
                  disabled={createMutation.isPending}
                />
              </Field>

              {/* Address (Collapsible) */}
              <Collapsible open={addressOpen} onOpenChange={setAddressOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between py-2">
                  <span className="text-sm font-medium">
                    Endereço (opcional)
                  </span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    className={`size-4 transition-transform ${addressOpen ? 'rotate-180' : ''}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="cep">CEP</FieldLabel>
                      <Input
                        id="cep"
                        value={formData.address.cep}
                        onChange={(e) =>
                          updateAddressField('cep', e.target.value)
                        }
                        placeholder="00000-000"
                        disabled={createMutation.isPending}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="state">Estado</FieldLabel>
                      <Input
                        id="state"
                        value={formData.address.state}
                        onChange={(e) =>
                          updateAddressField('state', e.target.value)
                        }
                        placeholder="SP"
                        disabled={createMutation.isPending}
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="city">Cidade</FieldLabel>
                    <Input
                      id="city"
                      value={formData.address.city}
                      onChange={(e) =>
                        updateAddressField('city', e.target.value)
                      }
                      placeholder="São Paulo"
                      disabled={createMutation.isPending}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="neighbourhood">Bairro</FieldLabel>
                    <Input
                      id="neighbourhood"
                      value={formData.address.neighbourhood}
                      onChange={(e) =>
                        updateAddressField('neighbourhood', e.target.value)
                      }
                      placeholder="Centro"
                      disabled={createMutation.isPending}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                    <Field>
                      <FieldLabel htmlFor="street">Rua</FieldLabel>
                      <Input
                        id="street"
                        value={formData.address.street}
                        onChange={(e) =>
                          updateAddressField('street', e.target.value)
                        }
                        placeholder="Rua das Flores"
                        disabled={createMutation.isPending}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="number">Número</FieldLabel>
                      <Input
                        id="number"
                        value={formData.address.number}
                        onChange={(e) =>
                          updateAddressField('number', e.target.value)
                        }
                        placeholder="123"
                        disabled={createMutation.isPending}
                      />
                    </Field>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Submit */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/dashboard/clients' })}
                  disabled={createMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Salvando...' : 'Criar Cliente'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
