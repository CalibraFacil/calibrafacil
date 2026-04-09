import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { parseAsInteger, useQueryState } from 'nuqs'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import {
  DynamicSpecsForm,
  type SpecFieldDefinition,
} from '@/components/dynamic-specs-form'

const statusLabels: Record<FormData['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

export const Route = createFileRoute('/dashboard/assets/new')({
  head: () => ({
    meta: [{ title: 'Novo Ativo | CalibraFácil' }],
  }),
  component: NewAssetPage,
})

interface FormData {
  customerId: number | null
  assetTypeId: number | null
  name: string
  manufacturer: string
  model: string
  serialNumber: string
  tag: string
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'
  lastCalibrationDate: Date | undefined
  nextCalibrationDate: Date | undefined
  comments: string
  specifications: Record<string, unknown>
}

const initialFormData: FormData = {
  customerId: null,
  assetTypeId: null,
  name: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  tag: '',
  status: 'ACTIVE',
  lastCalibrationDate: undefined,
  nextCalibrationDate: undefined,
  comments: '',
  specifications: {},
}

type AssetType = {
  id: number
  name: string
  slug: string
  description: string | null
  definition: SpecFieldDefinition[]
}

function NewAssetPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Read customerId from query params (e.g., /dashboard/assets/new?customerId=123)
  const [customerIdParam] = useQueryState('customerId', parseAsInteger)

  const [formData, setFormData] = useState<FormData>(() => ({
    ...initialFormData,
    customerId: customerIdParam ?? null,
  }))
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormData | string, string>>
  >({})
  const [customerSearch, setCustomerSearch] = useState('')

  // Fetch customers for the combobox
  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', 'search', customerSearch],
    queryFn: async () => {
      const res = await api.api.customers.$get({
        query: {
          page: '1',
          limit: '50',
          query: customerSearch || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar clientes')
      }

      return res.json()
    },
    staleTime: 30000,
  })

  // Fetch asset types for the dropdown
  const { data: assetTypesData, isLoading: assetTypesLoading } = useQuery({
    queryKey: ['asset-types'],
    queryFn: async () => {
      const res = await api.api['asset-types'].$get({
        query: {},
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar tipos de instrumento')
      }

      return res.json() as Promise<{ data: AssetType[] }>
    },
    staleTime: 60000, // Cache for 1 minute
  })

  // Get the selected customer name
  const selectedCustomerName = useMemo(() => {
    if (!formData.customerId || !customersData?.data) return ''
    const customer = customersData.data.find(
      (c) => c.id === formData.customerId,
    )
    return customer?.name || ''
  }, [formData.customerId, customersData?.data])

  // Get the selected asset type
  const selectedAssetType = useMemo(() => {
    if (!formData.assetTypeId || !assetTypesData?.data) return null
    return (
      assetTypesData.data.find((t) => t.id === formData.assetTypeId) || null
    )
  }, [formData.assetTypeId, assetTypesData?.data])

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!data.customerId) {
        throw new Error('Cliente é obrigatório')
      }
      if (!data.assetTypeId) {
        throw new Error('Tipo de instrumento é obrigatório')
      }

      const res = await api.api.assets.$post({
        json: {
          customerId: data.customerId,
          assetTypeId: data.assetTypeId,
          name: data.name,
          manufacturer: data.manufacturer || undefined,
          model: data.model || undefined,
          serialNumber: data.serialNumber,
          tag: data.tag,
          status: data.status,
          lastCalibrationDate:
            data.lastCalibrationDate?.toISOString() || undefined,
          nextCalibrationDate:
            data.nextCalibrationDate?.toISOString() || undefined,
          comments: data.comments || undefined,
          specifications:
            Object.keys(data.specifications).length > 0
              ? data.specifications
              : undefined,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar ativo',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      toast.success('Ativo criado com sucesso!')
      navigate({ to: '/dashboard/assets' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData | string, string>> = {}

    if (!formData.customerId) {
      newErrors.customerId = 'Cliente é obrigatório'
    }

    if (!formData.assetTypeId) {
      newErrors.assetTypeId = 'Tipo de instrumento é obrigatório'
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório'
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Nome deve ter pelo menos 2 caracteres'
    }

    if (!formData.serialNumber.trim()) {
      newErrors.serialNumber = 'Número de série é obrigatório'
    }

    if (!formData.tag.trim()) {
      newErrors.tag = 'Tag é obrigatória'
    }

    // Validate required specification fields
    if (selectedAssetType?.definition) {
      for (const field of selectedAssetType.definition) {
        if (field.required) {
          const value = formData.specifications[field.key]
          if (value === undefined || value === null || value === '') {
            newErrors[`spec_${field.key}`] = `${field.label} é obrigatório`
          }
        }
      }
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

  // Handle asset type change - reset specifications when type changes
  const handleAssetTypeChange = (typeId: number | null) => {
    setFormData((prev) => ({
      ...prev,
      assetTypeId: typeId,
      specifications: {}, // Reset specifications when type changes
    }))
    // Clear type error
    if (errors.assetTypeId) {
      setErrors((prev) => ({ ...prev, assetTypeId: undefined }))
    }
    // Clear specification errors
    const specErrorKeys = Object.keys(errors).filter((k) =>
      k.startsWith('spec_'),
    )
    if (specErrorKeys.length > 0) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        for (const key of specErrorKeys) {
          delete newErrors[key]
        }
        return newErrors
      })
    }
  }

  // Get specification errors in the format expected by DynamicSpecsForm
  const specErrors = useMemo(() => {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(errors)) {
      if (key.startsWith('spec_') && value) {
        result[key.replace('spec_', '')] = value
      }
    }
    return result
  }, [errors])

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/assets' })}
          className="mb-4"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo Ativo</CardTitle>
          <CardDescription>
            Cadastre um novo ativo ou instrumento vinculado a um cliente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {/* Customer Selection */}
              <Field>
                <FieldLabel htmlFor="customer">Cliente *</FieldLabel>
                <Combobox
                  value={formData.customerId ? String(formData.customerId) : ''}
                  onValueChange={(value) => {
                    updateField('customerId', value ? Number(value) : null)
                  }}
                  disabled={createMutation.isPending}
                >
                  <ComboboxInput
                    placeholder="Buscar cliente..."
                    value={selectedCustomerName || customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    showClear={!!formData.customerId}
                  />
                  <ComboboxContent>
                    <ComboboxList>
                      <ComboboxEmpty>
                        {customersLoading
                          ? 'Carregando...'
                          : 'Nenhum cliente encontrado'}
                      </ComboboxEmpty>
                      {customersData?.data?.map((customer) => (
                        <ComboboxItem
                          key={customer.id}
                          value={String(customer.id)}
                        >
                          {customer.name}
                          {customer.taxId && (
                            <span className="text-muted-foreground ml-2 text-xs">
                              {customer.taxId}
                            </span>
                          )}
                        </ComboboxItem>
                      ))}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <FieldDescription>
                  Selecione o cliente proprietário do ativo.
                </FieldDescription>
                {errors.customerId && (
                  <FieldError>{errors.customerId}</FieldError>
                )}
              </Field>

              {/* Asset Type Selection */}
              <Field>
                <FieldLabel htmlFor="assetType">
                  Tipo de Instrumento *
                </FieldLabel>
                <Select
                  value={
                    formData.assetTypeId ? String(formData.assetTypeId) : ''
                  }
                  onValueChange={(value) => {
                    handleAssetTypeChange(value ? Number(value) : null)
                  }}
                  disabled={createMutation.isPending || assetTypesLoading}
                >
                  <SelectTrigger id="assetType">
                    <span>
                      {assetTypesLoading
                        ? 'Carregando...'
                        : selectedAssetType?.name || 'Selecione o tipo...'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {assetTypesData?.data?.map((type) => (
                      <SelectItem key={type.id} value={String(type.id)}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  O tipo define as especificações técnicas do instrumento.
                </FieldDescription>
                {errors.assetTypeId && (
                  <FieldError>{errors.assetTypeId}</FieldError>
                )}
              </Field>

              {/* Name */}
              <Field>
                <FieldLabel htmlFor="name">Nome do Ativo *</FieldLabel>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Ex: Balança Analítica"
                  disabled={createMutation.isPending}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              {/* Tag */}
              <Field>
                <FieldLabel htmlFor="tag">Tag / ID Interno *</FieldLabel>
                <Input
                  id="tag"
                  value={formData.tag}
                  onChange={(e) => updateField('tag', e.target.value)}
                  placeholder="Ex: BAL-001"
                  disabled={createMutation.isPending}
                />
                <FieldDescription>
                  Identificador único do ativo no laboratório.
                </FieldDescription>
                {errors.tag && <FieldError>{errors.tag}</FieldError>}
              </Field>

              {/* Manufacturer and Model */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="manufacturer">Fabricante</FieldLabel>
                  <Input
                    id="manufacturer"
                    value={formData.manufacturer}
                    onChange={(e) =>
                      updateField('manufacturer', e.target.value)
                    }
                    placeholder="Ex: Mettler Toledo"
                    disabled={createMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    placeholder="Ex: XPE205"
                    disabled={createMutation.isPending}
                  />
                </Field>
              </div>

              {/* Serial Number */}
              <Field>
                <FieldLabel htmlFor="serialNumber">
                  Número de Série *
                </FieldLabel>
                <Input
                  id="serialNumber"
                  value={formData.serialNumber}
                  onChange={(e) => updateField('serialNumber', e.target.value)}
                  placeholder="Número de série do fabricante"
                  disabled={createMutation.isPending}
                />
                {errors.serialNumber && (
                  <FieldError>{errors.serialNumber}</FieldError>
                )}
              </Field>

              {/* Status */}
              <Field>
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Select
                  value={formData.status}
                  onValueChange={(value) => {
                    if (value)
                      updateField('status', value as FormData['status'])
                  }}
                  disabled={createMutation.isPending}
                >
                  <SelectTrigger>
                    <span>{statusLabels[formData.status]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="INACTIVE">Inativo</SelectItem>
                    <SelectItem value="MAINTENANCE">Em Manutenção</SelectItem>
                    <SelectItem value="SCRAPPED">Descartado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {/* Dynamic Specifications Form */}
              {selectedAssetType && selectedAssetType.definition.length > 0 && (
                <DynamicSpecsForm
                  definition={selectedAssetType.definition}
                  value={formData.specifications}
                  onChange={(specs) => updateField('specifications', specs)}
                  disabled={createMutation.isPending}
                  errors={specErrors}
                />
              )}

              {/* Calibration Dates */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="lastCalibrationDate">
                    Última Calibração
                  </FieldLabel>
                  <DatePicker
                    value={formData.lastCalibrationDate}
                    onChange={(date) =>
                      updateField('lastCalibrationDate', date)
                    }
                    placeholder="Selecione a data"
                    disabled={createMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="nextCalibrationDate">
                    Próxima Calibração
                  </FieldLabel>
                  <DatePicker
                    value={formData.nextCalibrationDate}
                    onChange={(date) =>
                      updateField('nextCalibrationDate', date)
                    }
                    placeholder="Selecione a data"
                    disabled={createMutation.isPending}
                  />
                </Field>
              </div>

              {/* Comments */}
              <Field>
                <FieldLabel htmlFor="comments">Observações</FieldLabel>
                <Textarea
                  id="comments"
                  value={formData.comments}
                  onChange={(e) => updateField('comments', e.target.value)}
                  placeholder="Observações adicionais sobre o ativo..."
                  disabled={createMutation.isPending}
                  rows={3}
                />
              </Field>

              {/* Submit */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/dashboard/assets' })}
                  disabled={createMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Salvando...' : 'Criar Ativo'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
