import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EnvironmentalLimit } from '@calibra-facil/client-runtime'
import {
  ThermometerIcon,
  Add01Icon,
  Delete02Icon,
  DropletIcon,
  CompassIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useDashboardUnits } from '@/hooks/use-dashboard-units'
import { calibraApi } from '@/utils/api'
import {
  useEnvironmentalLimitsData,
  useSettingsAssetTypesData,
} from '@/features/settings/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Field, FieldLabel } from '@/components/ui/field'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

interface LimitFormState {
  assetTypeId: number | null
  temperatureMin: string
  temperatureMax: string
  humidityMin: string
  humidityMax: string
  pressureMin: string
  pressureMax: string
}

const emptyForm: LimitFormState = {
  assetTypeId: null,
  temperatureMin: '',
  temperatureMax: '',
  humidityMin: '',
  humidityMax: '',
  pressureMin: '',
  pressureMax: '',
}

export function EnvironmentSettingsPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<LimitFormState>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [dialogMode, setDialogMode] = useState<'default' | 'override'>(
    'default',
  )

  const { isCheckingAccess, isConsolidated, selectedUnit } = useDashboardUnits()

  const { data: limitsData, isLoading } = useEnvironmentalLimitsData({
    enabled: Boolean(selectedUnit),
    unitId: typeof selectedUnit?.id === 'number' ? selectedUnit.id : null,
  })

  const { data: assetTypesData } = useSettingsAssetTypesData()

  const limits = limitsData?.limits ?? []
  const assetTypes = assetTypesData?.data ?? []

  // Separate unit default from asset-type overrides
  const unitDefault = limits.find((l) => l.assetTypeId === null)
  const overrides = limits.filter((l) => l.assetTypeId !== null)

  // Upsert mutation
  const upsertMutation = useMutation({
    mutationFn: async (data: LimitFormState) => {
      return calibraApi.environmentalLimits.save({
        assetTypeId: data.assetTypeId,
        temperatureMin: data.temperatureMin
          ? Number(data.temperatureMin)
          : null,
        temperatureMax: data.temperatureMax
          ? Number(data.temperatureMax)
          : null,
        humidityMin: data.humidityMin ? Number(data.humidityMin) : null,
        humidityMax: data.humidityMax ? Number(data.humidityMax) : null,
        pressureMin: data.pressureMin ? Number(data.pressureMin) : null,
        pressureMax: data.pressureMax ? Number(data.pressureMax) : null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['environmental-limits', selectedUnit?.id ?? 'no-unit'],
      })
      toast.success('Limites ambientais salvos')
      setDialogOpen(false)
      setForm(emptyForm)
      setEditingId(null)
    },
    onError: () => {
      toast.error('Erro ao salvar limites')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return calibraApi.environmentalLimits.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['environmental-limits', selectedUnit?.id ?? 'no-unit'],
      })
      toast.success('Limites removidos')
    },
    onError: () => {
      toast.error('Erro ao remover limites')
    },
  })

  function openEditDialog(limit: EnvironmentalLimit) {
    setForm({
      assetTypeId: limit.assetTypeId,
      temperatureMin: limit.temperatureMin?.toString() ?? '',
      temperatureMax: limit.temperatureMax?.toString() ?? '',
      humidityMin: limit.humidityMin?.toString() ?? '',
      humidityMax: limit.humidityMax?.toString() ?? '',
      pressureMin: limit.pressureMin?.toString() ?? '',
      pressureMax: limit.pressureMax?.toString() ?? '',
    })
    setEditingId(limit.id)
    setDialogMode(limit.assetTypeId == null ? 'default' : 'override')
    setDialogOpen(true)
  }

  function openNewOverrideDialog() {
    setForm(emptyForm)
    setEditingId(null)
    setDialogMode('override')
    setDialogOpen(true)
  }

  function openDefaultDialog() {
    if (unitDefault) {
      openEditDialog(unitDefault)
    } else {
      setForm(emptyForm)
      setEditingId(null)
      setDialogMode('default')
      setDialogOpen(true)
    }
  }

  // Asset types that already have overrides
  const usedAssetTypeIds = new Set(overrides.map((o) => o.assetTypeId))
  const availableAssetTypes = assetTypes.filter(
    (at) => !usedAssetTypeIds.has(at.id),
  )

  if (isCheckingAccess) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-balance text-lg font-semibold tracking-tight">
            Condições ambientais
          </h2>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Limites configurados por unidade e usados nas execuções para
            sinalizar temperatura, umidade e pressão fora de faixa.
          </p>
        </div>
        {selectedUnit && !isConsolidated ? (
          <Badge variant="secondary" className="shrink-0">
            {selectedUnit.name}
          </Badge>
        ) : null}
      </div>

      {isConsolidated ? (
        <Panel className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            A visão consolidada está ativa. Selecione uma unidade específica no
            switcher para editar ou revisar os limites ambientais aplicados a
            ela.
          </p>
        </Panel>
      ) : !selectedUnit ? (
        <Panel className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade ativa encontrada para esta organização.
          </p>
        </Panel>
      ) : (
        <Panel className="p-5 sm:p-6">
          <div className="divide-y divide-foreground/10">
            {/* Default limits */}
            <section className="pb-6">
              <PanelHeader
                title="Limites padrão"
                description="Aplicados a todas as calibrações da unidade, salvo exceções por tipo de equipamento."
                action={
                  unitDefault ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openDefaultDialog}
                    >
                      Editar
                    </Button>
                  ) : undefined
                }
              />
              <div className="mt-4">
                {isLoading ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </div>
                ) : unitDefault ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <LimitDisplay
                      icon={ThermometerIcon}
                      label="Temperatura"
                      min={unitDefault.temperatureMin}
                      max={unitDefault.temperatureMax}
                      unit="°C"
                    />
                    <LimitDisplay
                      icon={DropletIcon}
                      label="Umidade"
                      min={unitDefault.humidityMin}
                      max={unitDefault.humidityMax}
                      unit="%RH"
                    />
                    <LimitDisplay
                      icon={CompassIcon}
                      label="Pressão"
                      min={unitDefault.pressureMin}
                      max={unitDefault.pressureMax}
                      unit="hPa"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-xl bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">
                      Nenhum limite padrão configurado — calibrações nesta
                      unidade serão realizadas sem verificação de condições
                      ambientais.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openDefaultDialog}
                    >
                      Configurar limites padrão
                    </Button>
                  </div>
                )}
              </div>
            </section>

            {/* Per-asset-type overrides */}
            <section className="pt-6">
              <PanelHeader
                title="Por tipo de equipamento"
                description="Exceções que sobrescrevem os limites padrão para tipos específicos de instrumento."
                action={
                  overrides.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openNewOverrideDialog}
                      disabled={availableAssetTypes.length === 0}
                    >
                      <HugeiconsIcon icon={Add01Icon} className="mr-1.5 size-4" />
                      Adicionar
                    </Button>
                  ) : undefined
                }
              />
              <div className="mt-4">
                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </div>
                ) : overrides.length === 0 ? (
                  <Empty>
                    <EmptyMedia>
                      <HugeiconsIcon
                        icon={ThermometerIcon}
                        className="size-8 text-muted-foreground"
                      />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>Sem limites específicos</EmptyTitle>
                      <EmptyDescription>
                        Todos os tipos de equipamento usarão os limites padrão
                        da unidade.
                      </EmptyDescription>
                    </EmptyHeader>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openNewOverrideDialog}
                      disabled={availableAssetTypes.length === 0}
                    >
                      <HugeiconsIcon icon={Add01Icon} className="mr-1.5 size-4" />
                      Adicionar exceção
                    </Button>
                  </Empty>
                ) : (
                  <div className="space-y-2">
                    {overrides.map((override) => (
                      <div
                        key={override.id}
                        className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {override.assetTypeName}
                            </span>
                            <Badge variant="secondary">Exceção</Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
                            {override.temperatureMin != null && (
                              <span>
                                Temp {override.temperatureMin}–
                                {override.temperatureMax} °C
                              </span>
                            )}
                            {override.humidityMin != null && (
                              <span>
                                Umid. {override.humidityMin}–
                                {override.humidityMax} %RH
                              </span>
                            )}
                            {override.pressureMin != null && (
                              <span>
                                Pres. {override.pressureMin}–
                                {override.pressureMax} hPa
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(override)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deleteMutation.mutate(override.id)}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="size-4 text-destructive"
                            />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </Panel>
      )}

      {/* Upsert dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? 'Editar limites ambientais'
                : form.assetTypeId != null
                  ? 'Limites por tipo de equipamento'
                  : 'Limites ambientais'}
            </DialogTitle>
            <DialogDescription>
              Defina os limites mínimo e máximo aceitáveis durante a calibração.
              Campos em branco não serão verificados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {dialogMode === 'override' && !editingId && (
              <Field>
                <FieldLabel>Tipo de equipamento</FieldLabel>
                <Select
                  value={form.assetTypeId?.toString() ?? 'default'}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      assetTypeId: v === 'default' ? null : Number(v),
                    }))
                  }
                >
                  <SelectTrigger>
                    {form.assetTypeId == null
                      ? 'Padrão (todos os tipos)'
                      : (assetTypes.find((at) => at.id === form.assetTypeId)
                          ?.name ?? 'Selecione...')}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      Padrão (todos os tipos)
                    </SelectItem>
                    {availableAssetTypes.map((at) => (
                      <SelectItem key={at.id} value={at.id.toString()}>
                        {at.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <LimitField
              icon={ThermometerIcon}
              iconClass="text-orange-500"
              label="Temperatura (°C)"
              minValue={form.temperatureMin}
              maxValue={form.temperatureMax}
              minPlaceholder="Ex: 18"
              maxPlaceholder="Ex: 25"
              onMin={(value) =>
                setForm((f) => ({ ...f, temperatureMin: value }))
              }
              onMax={(value) =>
                setForm((f) => ({ ...f, temperatureMax: value }))
              }
            />
            <LimitField
              icon={DropletIcon}
              iconClass="text-blue-500"
              label="Umidade relativa (%RH)"
              minValue={form.humidityMin}
              maxValue={form.humidityMax}
              minPlaceholder="Ex: 30"
              maxPlaceholder="Ex: 70"
              onMin={(value) => setForm((f) => ({ ...f, humidityMin: value }))}
              onMax={(value) => setForm((f) => ({ ...f, humidityMax: value }))}
            />
            <LimitField
              icon={CompassIcon}
              iconClass="text-purple-500"
              label="Pressão atmosférica (hPa)"
              minValue={form.pressureMin}
              maxValue={form.pressureMax}
              minPlaceholder="Ex: 960"
              maxPlaceholder="Ex: 1060"
              onMin={(value) => setForm((f) => ({ ...f, pressureMin: value }))}
              onMax={(value) => setForm((f) => ({ ...f, pressureMax: value }))}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={() => upsertMutation.mutate(form)}
              disabled={upsertMutation.isPending}
            >
              {upsertMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LimitDisplay({
  icon,
  label,
  min,
  max,
  unit,
}: {
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon']
  label: string
  min: number | null
  max: number | null
  unit: string
}) {
  const configured = min != null && max != null

  return (
    <div className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex items-center gap-1.5">
        <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      {configured ? (
        <p className="mt-2 font-mono text-sm font-semibold tabular-nums">
          {min} – {max} {unit}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Não configurado</p>
      )}
    </div>
  )
}

function LimitField({
  icon,
  iconClass,
  label,
  minValue,
  maxValue,
  minPlaceholder,
  maxPlaceholder,
  onMin,
  onMax,
}: {
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon']
  iconClass: string
  label: string
  minValue: string
  maxValue: string
  minPlaceholder: string
  maxPlaceholder: string
  onMin: (value: string) => void
  onMax: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <HugeiconsIcon icon={icon} className={`size-4 ${iconClass}`} />
        {label}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Mínimo</FieldLabel>
          <Input
            type="number"
            step="0.1"
            placeholder={minPlaceholder}
            value={minValue}
            onChange={(e) => onMin(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>Máximo</FieldLabel>
          <Input
            type="number"
            step="0.1"
            placeholder={maxPlaceholder}
            value={maxValue}
            onChange={(e) => onMax(e.target.value)}
          />
        </Field>
      </div>
    </div>
  )
}
