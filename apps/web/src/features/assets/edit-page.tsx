import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { calibraApi } from '@/utils/api'
import { useAssetDetailData } from '@/features/assets/queries'
import type { AssetDetail } from '@/features/assets/types'
import {
  isAssetFormStatus,
  isAssetSpecificationErrorField,
  parseAssetEditForm,
  type AssetEditFormData,
  type AssetEditFormField,
} from '@/features/assets/forms'
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
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/ui/date-picker'
import { DynamicSpecsForm } from '@/components/dynamic-specs-form'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  type EccentricityIndicatorPosition,
  isEccentricityIndicatorPosition,
  isWeighingScaleAssetType,
} from '@/components/eccentricity-indicator'
import { assetRouteId } from '@/lib/route-identifiers'
import { isMassAssetTypeDefinition } from '@calibra-facil/shared'
import type { UpdateAssetInput } from '@calibra-facil/schemas'
import {
  shouldReturnToSyncConflicts,
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'

const statusLabels: Record<AssetEditFormData['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

function parseDate(date: string | Date | null | undefined): Date | undefined {
  if (!date) return undefined
  const d = new Date(date)
  return isNaN(d.getTime()) ? undefined : d
}

export function EditAssetPage({
  id,
  conflictReturn,
}: {
  id: string
  conflictReturn: SyncConflictReturnSearch
}) {
  // Fetch the asset data
  const { data: asset, isLoading, error: fetchError } = useAssetDetailData(id)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" disabled className="mb-4">
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
            Voltar
          </Button>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (fetchError || !asset) {
    return (
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/dashboard/assets" />}
            className="mb-4"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
            Voltar
          </Button>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Erro ao carregar ativo. Tente novamente.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <EditAssetForm
      key={asset.id}
      asset={asset}
      assetId={id}
      conflictReturn={conflictReturn}
    />
  )
}

function EditAssetForm({
  asset,
  assetId,
  conflictReturn,
}: {
  asset: AssetDetail
  assetId: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<AssetEditFormData>({
    name: asset.name,
    manufacturer: asset.manufacturer || '',
    model: asset.model || '',
    serialNumber: asset.serialNumber,
    tag: asset.tag,
    status: asset.status,
    lastCalibrationDate: parseDate(asset.lastCalibrationDate),
    nextCalibrationDate: parseDate(asset.nextCalibrationDate),
    comments: asset.comments || '',
    specifications: asset.specifications || {},
  })
  const [errors, setErrors] = useState<
    Partial<Record<AssetEditFormField, string>>
  >({})

  // Get the asset type definition from the asset data
  const assetTypeDefinition = useMemo(() => {
    if (!asset.assetTypeDefinition) return []
    return asset.assetTypeDefinition
  }, [asset.assetTypeDefinition])

  const visibleAssetTypeDefinition = useMemo(() => {
    return assetTypeDefinition.filter(
      (field) => field.key !== ECCENTRICITY_INDICATOR_SPEC_KEY,
    )
  }, [assetTypeDefinition])

  const selectedIndicatorPosition = isEccentricityIndicatorPosition(
    formData.specifications[ECCENTRICITY_INDICATOR_SPEC_KEY],
  )
    ? formData.specifications[ECCENTRICITY_INDICATOR_SPEC_KEY]
    : null

  const showEccentricityIndicator = isWeighingScaleAssetType({
    name: asset.assetTypeName,
    slug: asset.assetTypeSlug,
  })
  const requiresMassBaseUnit = isMassAssetTypeDefinition(assetTypeDefinition, {
    name: asset.assetTypeName,
    slug: asset.assetTypeSlug,
  })

  const updateMutation = useMutation({
    mutationFn: (data: UpdateAssetInput) =>
      calibraApi.assets.update(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset', assetId] })
      toast.success('Ativo atualizado com sucesso!')
      if (shouldReturnToSyncConflicts(conflictReturn)) {
        navigate({ to: '/dashboard/sync/conflicts' })
        return
      }
      navigate({
        to: '/dashboard/assets/$id',
        params: { id: assetRouteId({ tag: formData.tag }) },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseAssetEditForm(formData, {
      specificationFields: assetTypeDefinition,
    })
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

  const updateField = <TKey extends keyof AssetEditFormData>(
    field: TKey,
    value: AssetEditFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateIndicatorPosition = (
    position: EccentricityIndicatorPosition | null,
  ) => {
    const specifications = { ...formData.specifications }

    if (position) {
      specifications[ECCENTRICITY_INDICATOR_SPEC_KEY] = position
    } else {
      delete specifications[ECCENTRICITY_INDICATOR_SPEC_KEY]
    }

    updateField('specifications', specifications)
  }

  // Get specification errors in the format expected by DynamicSpecsForm
  const specErrors = useMemo(() => {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(errors)) {
      if (isAssetSpecificationErrorField(key) && value) {
        result[key.replace('spec_', '')] = value
      }
    }
    return result
  }, [errors])

  return (
    <div className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/dashboard/assets/$id" params={{ id: assetId }} />}
          className="mb-4"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Editar Ativo</CardTitle>
          <CardDescription>
            Atualize as informações do equipamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {/* Customer - Read only */}
              <Field>
                <FieldLabel>Cliente</FieldLabel>
                <Input value={asset.customerName ?? ''} disabled />
                <FieldDescription>
                  O cliente não pode ser alterado após o cadastro.
                </FieldDescription>
              </Field>

              {/* Asset Type - Read only */}
              <Field>
                <FieldLabel>Tipo de Instrumento</FieldLabel>
                <Input value={asset.assetTypeName ?? ''} disabled />
                <FieldDescription>
                  O tipo de instrumento não pode ser alterado após o cadastro.
                </FieldDescription>
              </Field>

              {requiresMassBaseUnit && (
                <Field>
                  <FieldLabel>Unidade Base do Instrumento</FieldLabel>
                  <Input value={asset.baseMeasurementUnit ?? '-'} disabled />
                  <FieldDescription>
                    A unidade base é fixada no cadastro e só pode ser alterada
                    via migração explícita.
                  </FieldDescription>
                </Field>
              )}

              {/* Name */}
              <Field>
                <FieldLabel htmlFor="name">Nome do Equipamento *</FieldLabel>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Ex: Balança Analítica"
                  disabled={updateMutation.isPending}
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
                  disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    placeholder="Ex: XPE205"
                    disabled={updateMutation.isPending}
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
                  disabled={updateMutation.isPending}
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
                    if (isAssetFormStatus(value)) {
                      updateField('status', value)
                    }
                  }}
                  disabled={updateMutation.isPending}
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
              {visibleAssetTypeDefinition.length > 0 && (
                <DynamicSpecsForm
                  definition={visibleAssetTypeDefinition}
                  value={formData.specifications}
                  onChange={(specs) => updateField('specifications', specs)}
                  disabled={updateMutation.isPending}
                  errors={specErrors}
                  activeMassUnit={asset.baseMeasurementUnit ?? null}
                />
              )}

              {showEccentricityIndicator && (
                <EccentricityIndicator
                  value={selectedIndicatorPosition}
                  onChange={updateIndicatorPosition}
                  disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
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
                  placeholder="Observações adicionais sobre o equipamento..."
                  disabled={updateMutation.isPending}
                  rows={3}
                />
              </Field>

              {/* Submit */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  render={
                    <Link to="/dashboard/assets/$id" params={{ id: assetId }} />
                  }
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
    </div>
  )
}
