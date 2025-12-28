import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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

  // Handle method selection - auto-fill and lock asset type
  useEffect(() => {
    if (formData.methodId) {
      const selectedMethod = methodsData?.data?.find(
        (m) => m.id === formData.methodId,
      )
      if (selectedMethod?.assetTypeId) {
        setFormData((prev) => ({
          ...prev,
          assetTypeId: selectedMethod.assetTypeId,
        }))
        setIsAssetTypeLocked(true)
      } else {
        setIsAssetTypeLocked(false)
      }
    } else {
      setIsAssetTypeLocked(false)
    }
  }, [formData.methodId, methodsData?.data])

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
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/services' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo Serviço</CardTitle>
          <CardDescription>
            Cadastre um novo serviço no catálogo do laboratório
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {/* Name */}
              <Field>
                <FieldLabel htmlFor="name">Nome do Serviço *</FieldLabel>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Ex: Calibração de Balança Digital 0-220g"
                  disabled={createMutation.isPending}
                />
                <FieldDescription>
                  Nome comercial do serviço como aparecerá para os clientes
                </FieldDescription>
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              {/* Description */}
              <Field>
                <FieldLabel htmlFor="description">Descrição</FieldLabel>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="Descrição detalhada do serviço..."
                  rows={3}
                  disabled={createMutation.isPending}
                />
                <FieldDescription>
                  Informações adicionais sobre o serviço (opcional)
                </FieldDescription>
              </Field>

              {/* Method Selector */}
              <Field>
                <FieldLabel htmlFor="method">Método de Calibração</FieldLabel>
                <Combobox
                  value={formData.methodId ? String(formData.methodId) : ''}
                  onValueChange={(value) =>
                    updateField('methodId', value ? Number(value) : null)
                  }
                  disabled={createMutation.isPending}
                >
                  <ComboboxInput placeholder="Selecionar método..." />
                  <ComboboxContent>
                    <ComboboxList>
                      <ComboboxEmpty>
                        {methodsLoading
                          ? 'Carregando...'
                          : 'Nenhum método publicado encontrado'}
                      </ComboboxEmpty>
                      {methodsData?.data?.map((method) => (
                        <ComboboxItem key={method.id} value={String(method.id)}>
                          <div className="flex flex-col">
                            <span>{method.name}</span>
                            {method.assetTypeName && (
                              <span className="text-xs text-muted-foreground">
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
                  Apenas métodos publicados são exibidos. O método define a
                  lógica de cálculo.
                </FieldDescription>
              </Field>

              {/* Asset Type Selector */}
              <Field>
                <FieldLabel htmlFor="assetType">
                  Tipo de Instrumento
                  {isAssetTypeLocked && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (definido pelo método)
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
                    placeholder={
                      isAssetTypeLocked
                        ? assetTypesData?.data?.find(
                            (at) => at.id === formData.assetTypeId,
                          )?.name || 'Selecionar...'
                        : 'Selecionar tipo...'
                    }
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
                {isAssetTypeLocked && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <HugeiconsIcon
                      icon={InformationCircleIcon}
                      className="h-3 w-3"
                    />
                    O tipo de instrumento é definido pelo método selecionado
                  </div>
                )}
                <FieldDescription>
                  Filtra os serviços disponíveis ao criar uma ordem de serviço
                </FieldDescription>
              </Field>

              {/* Price and TAT in a row */}
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="price">Preço (R$)</FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="price"
                      type="text"
                      inputMode="decimal"
                      value={formData.price}
                      onChange={(e) => updateField('price', e.target.value)}
                      placeholder="150,00"
                      className="pl-10"
                      disabled={createMutation.isPending}
                    />
                  </div>
                  <FieldDescription>
                    Deixe em branco para "Sob consulta"
                  </FieldDescription>
                  {errors.price && <FieldError>{errors.price}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="tat">Prazo (dias)</FieldLabel>
                  <div className="relative">
                    <Input
                      id="tat"
                      type="number"
                      min="1"
                      value={formData.tat}
                      onChange={(e) => updateField('tat', e.target.value)}
                      placeholder="5"
                      disabled={createMutation.isPending}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      dias
                    </span>
                  </div>
                  <FieldDescription>
                    Tempo de execução estimado
                  </FieldDescription>
                  {errors.tat && <FieldError>{errors.tat}</FieldError>}
                </Field>
              </div>

              {/* Active Status */}
              <Field>
                <div className="flex items-center justify-between">
                  <div>
                    <FieldLabel htmlFor="isActive">Serviço Ativo</FieldLabel>
                    <FieldDescription>
                      Serviços inativos não aparecem para clientes
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

              {/* Submit Buttons */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/dashboard/services' })}
                  disabled={createMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Salvando...' : 'Criar Serviço'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
