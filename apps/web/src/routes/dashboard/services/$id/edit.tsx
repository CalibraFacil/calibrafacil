import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
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

export const Route = createFileRoute('/dashboard/services/$id/edit')({
  head: () => ({
    meta: [{ title: 'Editar Serviço | CalibraFácil' }],
  }),
  component: EditServicePage,
})

interface FormData {
  name: string
  description: string
  methodId: number | null
  assetTypeId: number | null
  price: string
  tat: string
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

interface Service {
  id: number
  name: string
  description: string | null
  methodId: number | null
  methodName: string | null
  assetTypeId: number | null
  assetTypeName: string | null
  price: number | null
  currency: string
  tat: number | null
  isActive: boolean
}

function EditServicePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { id } = Route.useParams()

  const [formData, setFormData] = useState<FormData | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )
  const [isAssetTypeLocked, setIsAssetTypeLocked] = useState(false)

  // Fetch service data
  const {
    data: serviceData,
    isLoading: serviceLoading,
    error: serviceError,
  } = useQuery({
    queryKey: ['services', id],
    queryFn: async () => {
      const res = await api.api.services[':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar serviço')
      }

      return res.json() as Promise<Service>
    },
  })

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

  // Fetch audit log for ISO 17025 compliance (Clause 8.4)
  const { data: auditLogData } = useQuery({
    queryKey: ['services', id, 'audit-log'],
    queryFn: async () => {
      const res = await api.api.services[':id']['audit-log'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar histórico')
      }

      return res.json() as Promise<{ data: AuditLogRecord[] }>
    },
  })

  // Initialize form data when service loads
  useEffect(() => {
    if (serviceData && !formData) {
      setFormData({
        name: serviceData.name,
        description: serviceData.description || '',
        methodId: serviceData.methodId,
        assetTypeId: serviceData.assetTypeId,
        price:
          serviceData.price !== null
            ? (serviceData.price / 100).toFixed(2).replace('.', ',')
            : '',
        tat: serviceData.tat !== null ? String(serviceData.tat) : '',
        isActive: serviceData.isActive,
      })

      // Check if asset type should be locked based on method
      if (serviceData.methodId && methodsData?.data) {
        const method = methodsData.data.find(
          (m) => m.id === serviceData.methodId,
        )
        if (method?.assetTypeId) {
          setIsAssetTypeLocked(true)
        }
      }
    }
  }, [serviceData, formData, methodsData?.data])

  // Handle method selection - auto-fill and lock asset type
  useEffect(() => {
    if (formData?.methodId && methodsData?.data) {
      const selectedMethod = methodsData.data.find(
        (m) => m.id === formData.methodId,
      )
      if (selectedMethod?.assetTypeId) {
        setFormData((prev) =>
          prev
            ? {
                ...prev,
                assetTypeId: selectedMethod.assetTypeId,
              }
            : null,
        )
        setIsAssetTypeLocked(true)
      } else {
        setIsAssetTypeLocked(false)
      }
    } else if (formData) {
      setIsAssetTypeLocked(false)
    }
  }, [formData?.methodId, methodsData?.data])

  // Computed display values for combobox inputs
  const selectedMethodName = useMemo(() => {
    if (!formData?.methodId || !methodsData?.data) return ''
    const method = methodsData.data.find((m) => m.id === formData.methodId)
    return method?.name || ''
  }, [formData?.methodId, methodsData?.data])

  const selectedAssetTypeName = useMemo(() => {
    if (!formData?.assetTypeId || !assetTypesData?.data) return ''
    const assetType = assetTypesData.data.find(
      (at) => at.id === formData.assetTypeId,
    )
    return assetType?.name || ''
  }, [formData?.assetTypeId, assetTypesData?.data])

  // Update mutation
  const updateMutation = useMutation({
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

      const res = await api.api.services[':id'].$put({
        param: { id },
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
          (error as { error?: string }).error || 'Erro ao atualizar serviço',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.success('Serviço atualizado com sucesso!')
      navigate({ to: '/dashboard/services' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Validation
  const validate = (): boolean => {
    if (!formData) return false

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
    if (!formData || !validate()) return
    updateMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    setFormData((prev) => (prev ? { ...prev, [field]: value } : null))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  if (serviceError) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/services' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-500">
              Erro ao carregar serviço: {serviceError.message}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (serviceLoading || !formData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
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
          <CardTitle>Editar Serviço</CardTitle>
          <CardDescription>Atualize as informações do serviço</CardDescription>
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
                  disabled={updateMutation.isPending}
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
                  disabled={updateMutation.isPending}
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
                  disabled={updateMutation.isPending}
                >
                  <ComboboxInput
                    placeholder="Selecionar método..."
                    value={selectedMethodName}
                  />
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
                  disabled={updateMutation.isPending || isAssetTypeLocked}
                >
                  <ComboboxInput
                    placeholder="Selecionar tipo..."
                    value={selectedAssetTypeName}
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
                      disabled={updateMutation.isPending}
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
                      disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  />
                </div>
              </Field>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/dashboard/services' })}
                  disabled={updateMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending
                    ? 'Salvando...'
                    : 'Salvar Alterações'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {/* Audit Log - ISO 17025 Clause 8.4 (Control of Records) */}
      {auditLogData?.data && auditLogData.data.length > 0 && (
        <AuditTimeline
          events={buildAuditTimelineEvents(auditLogData.data)}
          title="Histórico de Alterações (ISO 17025)"
        />
      )}
    </div>
  )
}
