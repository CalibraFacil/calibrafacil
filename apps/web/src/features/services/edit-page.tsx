import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import type { UpdateServiceInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  usePublishedMethodsData,
  useServiceAssetTypesData,
  useServiceAuditLogData,
  useServiceDetailData,
} from '@/features/services/queries'
import {
  parseServiceEditForm,
  type ServiceFormData,
  type ServiceFormField,
} from '@/features/services/forms'
import type {
  PublishedMethodOption,
  ServiceAssetTypeOption,
  ServiceDetail,
} from '@/features/services/types'
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

export function EditServicePage({ id }: { id: string }) {
  const navigate = useNavigate()

  const {
    data: serviceData,
    isLoading: serviceLoading,
    error: serviceError,
  } = useServiceDetailData(id)

  const { data: methodsData, isLoading: methodsLoading } =
    usePublishedMethodsData()

  const { data: assetTypesData, isLoading: assetTypesLoading } =
    useServiceAssetTypesData()

  const { data: auditLogData } = useServiceAuditLogData(id)

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

  if (serviceLoading || methodsLoading || assetTypesLoading) {
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

  if (!serviceData) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Erro ao carregar serviço. Tente novamente.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <EditServiceForm
      key={serviceData.id}
      serviceData={serviceData}
      methodsData={methodsData?.data ?? []}
      assetTypesData={assetTypesData?.data ?? []}
      methodsLoading={methodsLoading}
      assetTypesLoading={assetTypesLoading}
      auditLogData={auditLogData?.data ?? []}
    />
  )
}

function EditServiceForm({
  serviceData,
  methodsData,
  assetTypesData,
  methodsLoading,
  assetTypesLoading,
  auditLogData,
}: {
  serviceData: ServiceDetail
  methodsData: Array<PublishedMethodOption>
  assetTypesData: Array<ServiceAssetTypeOption>
  methodsLoading: boolean
  assetTypesLoading: boolean
  auditLogData: Array<AuditLogRecord>
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<ServiceFormData>({
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
  const [errors, setErrors] = useState<
    Partial<Record<ServiceFormField, string>>
  >({})
  const [isAssetTypeLocked, setIsAssetTypeLocked] = useState(() => {
    const method = methodsData.find((m) => m.id === serviceData.methodId)
    return !!method?.assetTypeId
  })

  const updateMutation = useMutation({
    mutationFn: (data: UpdateServiceInput) =>
      calibraApi.services.update(serviceData.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      queryClient.invalidateQueries({ queryKey: ['services', serviceData.id] })
      toast.success('Serviço atualizado com sucesso!')
      navigate({ to: '/dashboard/services' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Computed display values for combobox inputs
  const selectedMethodName = useMemo(() => {
    if (!formData.methodId) return ''
    const method = methodsData.find((m) => m.id === formData.methodId)
    return method?.name || ''
  }, [formData.methodId, methodsData])

  const selectedAssetTypeName = useMemo(() => {
    if (!formData.assetTypeId) return ''
    const assetType = assetTypesData.find(
      (at) => at.id === formData.assetTypeId,
    )
    return assetType?.name || ''
  }, [formData.assetTypeId, assetTypesData])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseServiceEditForm(formData)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setErrors({})
    updateMutation.mutate(parsed.data)
  }

  const updateField = <TKey extends keyof ServiceFormData>(
    field: TKey,
    value: ServiceFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateMethodId = (methodId: number | null) => {
    const selectedMethod = methodsData.find((m) => m.id === methodId)
    setIsAssetTypeLocked(!!selectedMethod?.assetTypeId)
    setFormData((prev) => ({
      ...prev,
      methodId,
      assetTypeId: selectedMethod?.assetTypeId ?? prev.assetTypeId,
    }))
    if (errors.methodId || errors.assetTypeId) {
      setErrors((prev) => ({
        ...prev,
        methodId: undefined,
        assetTypeId: undefined,
      }))
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
                    updateMethodId(value ? Number(value) : null)
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
                      {methodsData.map((method) => (
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
                      {assetTypesData.map((assetType) => (
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
      {auditLogData.length > 0 && (
        <AuditTimeline
          events={buildAuditTimelineEvents(auditLogData)}
          title="Histórico de Alterações (ISO 17025)"
        />
      )}
    </div>
  )
}
