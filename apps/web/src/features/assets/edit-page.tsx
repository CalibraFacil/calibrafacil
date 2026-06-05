import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FloppyDiskIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { useAssetDetailData } from '@/features/assets/queries'
import type { AssetDetail } from '@/features/assets/types'
import {
  buildCalibrationPeriodicityPresets,
  isAssetFormStatus,
  isAssetSpecificationErrorField,
  parseAssetEditForm,
  type AssetEditFormData,
  type AssetEditFormField,
} from '@/features/assets/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { DatePicker } from '@/components/ui/date-picker'
import { DynamicSpecsForm } from '@/components/dynamic-specs-form'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import {
  FormSectionNav,
  type FormNavSection,
} from '@/features/assets/components/form-section-nav'
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
import { cn } from '@/lib/utils'

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

/** Read-only field for values that are fixed after registration. */
function LockedField({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        <HugeiconsIcon
          icon={SquareLock02Icon}
          className="size-3.5 text-muted-foreground/60"
        />
      </div>
      <p className="mt-1 text-sm font-medium">{value || '—'}</p>
      {hint ? (
        <p className="mt-1 text-pretty text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function EditAssetPage({
  id,
  conflictReturn,
}: {
  id: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const { data: asset, isLoading, error: fetchError } = useAssetDetailData(id)

  if (isLoading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_section, sectionIndex) => (
          <Panel key={sectionIndex} className="space-y-4 p-4 sm:p-5">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 3 }).map((_field, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </Panel>
        ))}
      </div>
    )
  }

  if (fetchError || !asset) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar ativo. Tente novamente.
        </p>
      </Panel>
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

  const assetTypeDefinition = useMemo(() => {
    if (!asset.assetTypeDefinition) return []
    return asset.assetTypeDefinition
  }, [asset.assetTypeDefinition])

  const visibleAssetTypeDefinition = useMemo(() => {
    return assetTypeDefinition.filter(
      (field) => field.key !== ECCENTRICITY_INDICATOR_SPEC_KEY,
    )
  }, [assetTypeDefinition])
  const hasSpecs = visibleAssetTypeDefinition.length > 0

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

  const specErrors = useMemo(() => {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(errors)) {
      if (isAssetSpecificationErrorField(key) && value) {
        result[key.replace('spec_', '')] = value
      }
    }
    return result
  }, [errors])

  const isSaving = updateMutation.isPending

  const navSections: FormNavSection[] = [
    { id: 'sec-identificacao', label: 'Identificação' },
    ...(hasSpecs || showEccentricityIndicator
      ? [{ id: 'sec-especificacoes', label: 'Especificações' }]
      : []),
    { id: 'sec-calibracao', label: 'Calibração', optional: true },
    { id: 'sec-observacoes', label: 'Observações', optional: true },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />

      <div>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {asset.tag}
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Editar ativo
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <FormSectionNav sections={navSections} />

        <div className="min-w-0 space-y-6">
          <Panel id="sec-identificacao" className="scroll-mt-6 p-4 sm:p-5">
            <PanelHeader
              eyebrow="Identificação"
              title="Dados do instrumento"
              description="Cliente, tipo e unidade base são fixados no cadastro para preservar a rastreabilidade."
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <LockedField
                label="Cliente"
                value={asset.customerName ?? ''}
                hint="Não pode ser alterado após o cadastro."
              />
              <LockedField
                label="Tipo de instrumento"
                value={asset.assetTypeName ?? ''}
                hint="Não pode ser alterado após o cadastro."
              />
              {requiresMassBaseUnit ? (
                <LockedField
                  label="Unidade base"
                  value={asset.baseMeasurementUnit ?? '—'}
                  hint="Alterável apenas via migração explícita."
                />
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="name">Nome do equipamento *</FieldLabel>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Ex: Balança Analítica"
                  disabled={isSaving}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              <Field>
                <FieldLabel htmlFor="tag">Tag / ID interno *</FieldLabel>
                <Input
                  id="tag"
                  value={formData.tag}
                  onChange={(e) => updateField('tag', e.target.value)}
                  placeholder="Ex: BAL-001"
                  className="font-mono"
                  disabled={isSaving}
                />
                {errors.tag && <FieldError>{errors.tag}</FieldError>}
              </Field>

              <Field>
                <FieldLabel htmlFor="serialNumber">
                  Número de série *
                </FieldLabel>
                <Input
                  id="serialNumber"
                  value={formData.serialNumber}
                  onChange={(e) => updateField('serialNumber', e.target.value)}
                  placeholder="Número de série do fabricante"
                  className="font-mono"
                  disabled={isSaving}
                />
                {errors.serialNumber && (
                  <FieldError>{errors.serialNumber}</FieldError>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="manufacturer">Fabricante</FieldLabel>
                <Input
                  id="manufacturer"
                  value={formData.manufacturer}
                  onChange={(e) => updateField('manufacturer', e.target.value)}
                  placeholder="Ex: Mettler Toledo"
                  disabled={isSaving}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="model">Modelo</FieldLabel>
                <Input
                  id="model"
                  value={formData.model}
                  onChange={(e) => updateField('model', e.target.value)}
                  placeholder="Ex: XPE205"
                  disabled={isSaving}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Select
                  value={formData.status}
                  onValueChange={(value) => {
                    if (isAssetFormStatus(value)) {
                      updateField('status', value)
                    }
                  }}
                  disabled={isSaving}
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
            </div>
          </Panel>

          {hasSpecs || showEccentricityIndicator ? (
            <Panel id="sec-especificacoes" className="scroll-mt-6 p-4 sm:p-5">
              <PanelHeader
                eyebrow="Características"
                title="Especificações técnicas"
                description="Parâmetros aplicados durante a calibração do instrumento."
              />
              {hasSpecs ? (
                <div className="mt-4">
                  <DynamicSpecsForm
                    definition={visibleAssetTypeDefinition}
                    value={formData.specifications}
                    onChange={(specs) => updateField('specifications', specs)}
                    disabled={isSaving}
                    errors={specErrors}
                    activeMassUnit={asset.baseMeasurementUnit ?? null}
                  />
                </div>
              ) : null}
              {showEccentricityIndicator ? (
                <EccentricityIndicator
                  value={selectedIndicatorPosition}
                  onChange={updateIndicatorPosition}
                  disabled={isSaving}
                  className={hasSpecs ? 'mt-5' : 'mt-4 border-t-0 pt-0'}
                />
              ) : null}
            </Panel>
          ) : null}

          <Panel id="sec-calibracao" className="scroll-mt-6 p-4 sm:p-5">
            <PanelHeader
              eyebrow="Programação"
              title="Calibração"
              description="Datas de referência usadas para acompanhar a validade do instrumento."
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="lastCalibrationDate">
                  Última calibração
                </FieldLabel>
                <DatePicker
                  value={formData.lastCalibrationDate}
                  onChange={(date) => updateField('lastCalibrationDate', date)}
                  placeholder="Selecione a data"
                  disabled={isSaving}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="nextCalibrationDate">
                  Próxima calibração
                </FieldLabel>
                <DatePicker
                  value={formData.nextCalibrationDate}
                  onChange={(date) => updateField('nextCalibrationDate', date)}
                  placeholder="Selecione a data"
                  disabled={isSaving}
                  presets={buildCalibrationPeriodicityPresets()}
                />
              </Field>
            </div>
          </Panel>

          <Panel id="sec-observacoes" className="scroll-mt-6 p-4 sm:p-5">
            <PanelHeader eyebrow="Notas" title="Observações" />
            <div className="mt-4">
              <Field>
                <FieldLabel htmlFor="comments" className="sr-only">
                  Observações
                </FieldLabel>
                <Textarea
                  id="comments"
                  value={formData.comments}
                  onChange={(e) => updateField('comments', e.target.value)}
                  placeholder="Observações adicionais sobre o equipamento..."
                  disabled={isSaving}
                  rows={3}
                />
              </Field>
            </div>
          </Panel>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
        <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="px-1 text-pretty text-xs text-muted-foreground">
            As alterações são registradas no histórico de auditoria.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              render={
                <Link to="/dashboard/assets/$id" params={{ id: assetId }} />
              }
              className={ACTION_BUTTON_CLASS}
              disabled={isSaving}
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
                  Salvando...
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
  )
}
