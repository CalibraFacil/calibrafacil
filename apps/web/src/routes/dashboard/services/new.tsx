import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

export const Route = createFileRoute('/dashboard/services/new')({
  head: () => ({
    meta: [{ title: 'Novo Serviço | CalibraFácil' }],
  }),
  component: NewServicePage,
})

interface FormData {
  name: string
  description: string
  methodId: number | null
  assetTypeId: number | null
  price: string // String for input, will convert to cents
  tat: string // String for input
  isActive: boolean
}

interface Method {
  id: number
  name: string
  status: string
  assetTypeId: number | null
  assetTypeName: string | null
}

interface AssetType {
  id: number
  name: string
  slug: string
}

const initialFormData: FormData = {
  name: '',
  description: '',
  methodId: null,
  assetTypeId: null,
  price: '',
  tat: '',
  isActive: true,
}

function NewServicePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )
  const [isAssetTypeLocked, setIsAssetTypeLocked] = useState(false)

  // Fetch published methods
  const { data: methodsData, isLoading: methodsLoading } = useQuery({
    queryKey: ['methods', 'published'],
    queryFn: async () => {
      const res = await api.api.methods.$get({
        query: {
          status: 'PUBLISHED',
          limit: '100',
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar métodos')
      }

      return res.json() as Promise<{
        data: Array<Method>
      }>
    },
  })

  // Fetch asset types
  const { data: assetTypesData, isLoading: assetTypesLoading } = useQuery({
    queryKey: ['asset-types'],
    queryFn: async () => {
      const res = await api.api['asset-types'].$get({
        query: {},
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar tipos de instrumento')
      }

      return res.json() as Promise<{
        data: Array<AssetType>
      }>
    },
  })

  const selectedMethod = useMemo(() => {
    if (!formData.methodId || !methodsData?.data) return null
    return methodsData.data.find((m) => m.id === formData.methodId) ?? null
  }, [formData.methodId, methodsData?.data])

  const selectedAssetType = useMemo(() => {
    if (!formData.assetTypeId || !assetTypesData?.data) return null
    return (
      assetTypesData.data.find((at) => at.id === formData.assetTypeId) ?? null
    )
  }, [formData.assetTypeId, assetTypesData?.data])

  // Computed display values for combobox inputs
  const selectedMethodName = selectedMethod?.name || ''
  const selectedAssetTypeName = selectedAssetType?.name || ''

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Convert price from BRL string to cents
      let priceInCents: number | null = null
      if (data.price.trim()) {
        const priceValue = parseFloat(data.price.replace(',', '.'))
        if (!isNaN(priceValue)) {
          priceInCents = Math.round(priceValue * 100)
        }
      }

      // Convert TAT to number
      let tatValue: number | null = null
      if (data.tat.trim()) {
        tatValue = parseInt(data.tat, 10)
        if (isNaN(tatValue)) {
          tatValue = null
        }
      }

      const res = await api.api.services.$post({
        json: {
          name: data.name,
          description: data.description || undefined,
          methodId: data.methodId,
          assetTypeId: data.assetTypeId,
          price: priceInCents,
          tat: tatValue,
          isActive: data.isActive,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar serviço',
        )
      }

      return res.json() as Promise<{ id: number }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.success('Serviço criado com sucesso!')
      navigate({ to: '/dashboard/services' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Validation
  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório'
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Nome deve ter pelo menos 2 caracteres'
    }

    if (formData.price.trim()) {
      const priceValue = parseFloat(formData.price.replace(',', '.'))
      if (isNaN(priceValue) || priceValue < 0) {
        newErrors.price = 'Preço inválido'
      }
    }

    if (formData.tat.trim()) {
      const tatValue = parseInt(formData.tat, 10)
      if (isNaN(tatValue) || tatValue < 1) {
        newErrors.tat = 'Prazo deve ser pelo menos 1 dia'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    createMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    if (field === 'methodId') {
      const methodId = value as FormData['methodId']
      const selectedMethod = methodsData?.data?.find((m) => m.id === methodId)
      setIsAssetTypeLocked(!!selectedMethod?.assetTypeId)
      setFormData((prev) => ({
        ...prev,
        methodId,
        assetTypeId: selectedMethod?.assetTypeId ?? prev.assetTypeId,
      }))
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }))
    }
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const registrationSummary = [
    {
      label: 'Serviço',
      value: formData.name || 'Nome pendente',
      complete: formData.name.trim().length >= 2,
    },
    {
      label: 'Método',
      value: selectedMethodName || 'Opcional',
      complete: Boolean(formData.methodId),
    },
    {
      label: 'Instrumento',
      value: selectedAssetTypeName || 'Não definido',
      complete: Boolean(formData.assetTypeId),
    },
    {
      label: 'Catálogo',
      value: formData.isActive ? 'Ativo ao criar' : 'Criado inativo',
      complete: formData.isActive,
    },
  ]

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Novo Serviço
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Cadastre um item do catálogo comercial, vincule ao método publicado
            e defina as condições usadas em ordens de serviço.
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form
          id="service-registration-form"
          onSubmit={handleSubmit}
          className="min-w-0"
        >
          <FieldGroup className="gap-0 divide-y">
            <FormSection
              title="Identificação"
              description="Nome comercial e descrição exibidos para equipe e clientes."
            >
              <div className="grid gap-5">
                <Field>
                  <FieldLabel htmlFor="name">Nome do Serviço *</FieldLabel>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Ex.: Calibração de Balança Digital 0-220g"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? 'name-error' : undefined}
                  />
                  <FieldDescription>
                    Use o nome como ele deve aparecer no catálogo.
                  </FieldDescription>
                  {errors.name && (
                    <FieldError id="name-error">{errors.name}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="description">Descrição</FieldLabel>
                  <Textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    placeholder="Descrição detalhada do serviço..."
                    rows={3}
                    disabled={createMutation.isPending}
                  />
                  <FieldDescription>
                    Inclua escopo, observações comerciais ou condições técnicas.
                  </FieldDescription>
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Método e instrumento"
              description="Vínculo técnico que define cálculo, rastreabilidade e filtro por tipo de instrumento."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="method">Método de Calibração</FieldLabel>
                  <Combobox
                    value={formData.methodId ? String(formData.methodId) : ''}
                    onValueChange={(value) =>
                      updateField('methodId', value ? Number(value) : null)
                    }
                    disabled={createMutation.isPending}
                  >
                    <ComboboxInput
                      id="method"
                      name="methodId"
                      placeholder="Selecionar método..."
                      value={selectedMethodName}
                      autoComplete="off"
                      showClear={Boolean(formData.methodId)}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        <ComboboxEmpty>
                          {methodsLoading
                            ? 'Carregando...'
                            : 'Nenhum método publicado encontrado'}
                        </ComboboxEmpty>
                        {methodsData?.data?.map((method) => (
                          <ComboboxItem
                            key={method.id}
                            value={String(method.id)}
                          >
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">{method.name}</span>
                              {method.assetTypeName && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {method.assetTypeName}
                                </span>
                              )}
                            </div>
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>
                    Apenas métodos publicados são exibidos.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="assetType">
                    Tipo de Instrumento
                    {isAssetTypeLocked && (
                      <span className="text-xs font-normal text-muted-foreground">
                        definido pelo método
                      </span>
                    )}
                  </FieldLabel>
                  <Combobox
                    value={
                      formData.assetTypeId ? String(formData.assetTypeId) : ''
                    }
                    onValueChange={(value) =>
                      updateField('assetTypeId', value ? Number(value) : null)
                    }
                    disabled={createMutation.isPending || isAssetTypeLocked}
                  >
                    <ComboboxInput
                      id="assetType"
                      name="assetTypeId"
                      placeholder="Selecionar tipo..."
                      value={selectedAssetTypeName}
                      autoComplete="off"
                      disabled={isAssetTypeLocked}
                      showClear={Boolean(formData.assetTypeId)}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        <ComboboxEmpty>
                          {assetTypesLoading
                            ? 'Carregando...'
                            : 'Nenhum tipo encontrado'}
                        </ComboboxEmpty>
                        {assetTypesData?.data?.map((assetType) => (
                          <ComboboxItem
                            key={assetType.id}
                            value={String(assetType.id)}
                          >
                            {assetType.name}
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  {isAssetTypeLocked ? (
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <HugeiconsIcon
                        icon={InformationCircleIcon}
                        className="size-3"
                      />
                      O tipo de instrumento acompanha o método selecionado.
                    </div>
                  ) : (
                    <FieldDescription>
                      Filtra serviços ao criar uma ordem de serviço.
                    </FieldDescription>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Condições comerciais"
              description="Valores de referência para orçamento e prazo esperado de execução."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="price">Preço (R$)</FieldLabel>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="price"
                      name="price"
                      type="text"
                      inputMode="decimal"
                      value={formData.price}
                      onChange={(e) => updateField('price', e.target.value)}
                      placeholder="150,00"
                      className="pl-10 tabular-nums"
                      disabled={createMutation.isPending}
                      aria-invalid={Boolean(errors.price)}
                      aria-describedby={
                        errors.price ? 'price-error' : 'price-description'
                      }
                    />
                  </div>
                  <FieldDescription id="price-description">
                    Deixe em branco para "Sob consulta".
                  </FieldDescription>
                  {errors.price && (
                    <FieldError id="price-error">{errors.price}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="tat">Prazo (dias)</FieldLabel>
                  <div className="relative">
                    <Input
                      id="tat"
                      name="tat"
                      type="number"
                      min="1"
                      value={formData.tat}
                      onChange={(e) => updateField('tat', e.target.value)}
                      placeholder="5"
                      className="pr-14 tabular-nums"
                      disabled={createMutation.isPending}
                      aria-invalid={Boolean(errors.tat)}
                      aria-describedby={
                        errors.tat ? 'tat-error' : 'tat-description'
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      dias
                    </span>
                  </div>
                  <FieldDescription id="tat-description">
                    Tempo de execução estimado.
                  </FieldDescription>
                  {errors.tat && (
                    <FieldError id="tat-error">{errors.tat}</FieldError>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Disponibilidade"
              description="Controle se o serviço entra imediatamente no fluxo operacional."
            >
              <Field>
                <div className="flex min-h-10 items-center justify-between gap-4 py-1">
                  <div className="min-w-0 space-y-1">
                    <FieldLabel htmlFor="isActive">Serviço ativo</FieldLabel>
                    <FieldDescription>
                      Serviços inativos ficam ocultos para clientes.
                    </FieldDescription>
                  </div>
                  <Switch
                    id="isActive"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      updateField('isActive', checked)
                    }
                    disabled={createMutation.isPending}
                  />
                </div>
              </Field>
            </FormSection>

            <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/services' })}
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                {createMutation.isPending ? 'Salvando...' : 'Criar Serviço'}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-l pl-5">
            <h2 className="text-sm font-medium">Resumo do Cadastro</h2>
            <dl className="mt-4 space-y-4">
              {registrationSummary.map((item) => (
                <div key={item.label} className="space-y-1">
                  <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        item.complete ? 'bg-primary' : 'bg-muted-foreground/35'
                      }`}
                    />
                    {item.label}
                  </dt>
                  <dd className="min-w-0 truncate text-sm text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground text-pretty">
              O serviço fica disponível para orçamentos e ordens assim que for
              criado como ativo.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-balance">{title}</h2>
        {description && (
          <p className="text-sm leading-5 text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
