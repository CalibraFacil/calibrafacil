import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FloppyDiskIcon } from '@hugeicons/core-free-icons'
import type { UpdateServiceInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  usePublishedMethodsData,
  useServiceAssetTypesData,
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
import { ServiceFormFields } from '@/features/services/new-page'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

export function EditServicePage({ id }: { id: string }) {
  const {
    data: serviceData,
    isLoading: serviceLoading,
    error: serviceError,
  } = useServiceDetailData(id)

  const { data: methodsData, isLoading: methodsLoading } =
    usePublishedMethodsData()
  const { data: assetTypesData, isLoading: assetTypesLoading } =
    useServiceAssetTypesData()

  if (serviceLoading || methodsLoading || assetTypesLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-7 w-52" />
        </div>
        {Array.from({ length: 3 }).map((_section, index) => (
          <Skeleton key={index} className="h-40 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (serviceError || !serviceData) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          {serviceError
            ? `Erro ao carregar serviço: ${serviceError.message}`
            : 'Serviço não encontrado.'}
        </p>
      </Panel>
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
    />
  )
}

function EditServiceForm({
  serviceData,
  methodsData,
  assetTypesData,
  methodsLoading,
  assetTypesLoading,
}: {
  serviceData: ServiceDetail
  methodsData: Array<PublishedMethodOption>
  assetTypesData: Array<ServiceAssetTypeOption>
  methodsLoading: boolean
  assetTypesLoading: boolean
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
  const isSaving = updateMutation.isPending

  const selectedMethodName = useMemo(() => {
    if (!formData.methodId) return ''
    return methodsData.find((m) => m.id === formData.methodId)?.name || ''
  }, [formData.methodId, methodsData])

  const selectedAssetTypeName = useMemo(() => {
    if (!formData.assetTypeId) return ''
    return (
      assetTypesData.find((at) => at.id === formData.assetTypeId)?.name || ''
    )
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
    const method = methodsData.find((m) => m.id === methodId)
    setIsAssetTypeLocked(!!method?.assetTypeId)
    setFormData((prev) => ({
      ...prev,
      methodId,
      assetTypeId: method?.assetTypeId ?? prev.assetTypeId,
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
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Catálogo de serviços
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Editar serviço
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <ServiceFormFields
          formData={formData}
          errors={errors}
          disabled={isSaving}
          methods={methodsData}
          assetTypes={assetTypesData}
          methodsLoading={methodsLoading}
          assetTypesLoading={assetTypesLoading}
          isAssetTypeLocked={isAssetTypeLocked}
          selectedMethodName={selectedMethodName}
          selectedAssetTypeName={selectedAssetTypeName}
          updateField={updateField}
          updateMethodId={updateMethodId}
        />

        <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
          <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="px-1 text-pretty text-xs text-muted-foreground">
              As alterações são registradas no histórico de alterações.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/services' })}
                disabled={isSaving}
                className={ACTION_BUTTON_CLASS}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className={cn(ACTION_BUTTON_CLASS, 'min-w-40')}
              >
                {isSaving ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando…
                  </>
                ) : (
                  <>
                    <HugeiconsIcon
                      icon={FloppyDiskIcon}
                      className="mr-2 size-4"
                    />
                    Salvar alterações
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
