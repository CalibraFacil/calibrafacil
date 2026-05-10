import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Field, FieldLabel } from '@/components/ui/field'
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

export const Route = createFileRoute('/dashboard/settings/environment')({
  head: () => ({
    meta: [
      { title: 'Condições Ambientais | Configurações | CalibraFácil' },
    ],
  }),
  component: EnvironmentSettingsPage,
})

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

function EnvironmentSettingsPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<LimitFormState>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [dialogMode, setDialogMode] = useState<'default' | 'override'>('default')

  const { isCheckingAccess, isConsolidated, selectedUnit } =
    useDashboardUnits()

  // Fetch all limits for the selected unit
  const { data: limitsData, isLoading } = useQuery({
    queryKey: ['environmental-limits', selectedUnit?.id ?? 'no-unit'],
    enabled: Boolean(selectedUnit),
    queryFn: () => calibraApi.environmentalLimits.list(),
  })

  // Fetch asset types
  const { data: assetTypesData } = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => calibraApi.assetTypes.list(),
    staleTime: 60000,
  })

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
        temperatureMin: data.temperatureMin ? Number(data.temperatureMin) : null,
        temperatureMax: data.temperatureMax ? Number(data.temperatureMax) : null,
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
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Escopo das Condições Ambientais</CardTitle>
          <CardDescription>
            Os limites ambientais são configurados por unidade operacional e
            usados nas execuções dos jobs daquela unidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConsolidated ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              A visão consolidada está ativa. Selecione uma unidade específica no
              switcher para editar ou revisar os limites ambientais aplicados a
              ela.
            </div>
          ) : selectedUnit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{selectedUnit.name}</Badge>
              <Badge variant="outline">Escopo operacional ativo</Badge>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nenhuma unidade ativa encontrada para esta organização.
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedUnit ? null : (
        <>
      {/* Default limits */}
      <Card>
        <CardHeader>
          <CardTitle>Limites Padrão</CardTitle>
          <CardDescription>
            Limites ambientais padrão aplicados a todas as calibrações da
            unidade selecionada. Tipos de equipamento podem ter limites
            específicos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : unitDefault ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
              <Button variant="outline" size="sm" onClick={openDefaultDialog}>
                Editar limites padrão
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Nenhum limite padrão configurado. Calibrações serão realizadas
                sem verificação de condições ambientais nesta unidade.
              </p>
              <Button variant="outline" size="sm" onClick={openDefaultDialog}>
                Configurar limites padrão
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-asset-type overrides */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Limites por Tipo de Equipamento</CardTitle>
              <CardDescription>
                Limites específicos que sobrescrevem os padrão para
                determinados tipos de instrumento dentro da unidade ativa.
              </CardDescription>
            </div>
            {overrides.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={openNewOverrideDialog}
                disabled={availableAssetTypes.length === 0}
              >
                <HugeiconsIcon icon={Add01Icon} className="size-4 mr-1.5" />
                Adicionar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
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
                  Todos os tipos de equipamento usarão os limites padrão da
                  unidade selecionada.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                variant="outline"
                size="sm"
                onClick={openNewOverrideDialog}
                disabled={availableAssetTypes.length === 0}
              >
                <HugeiconsIcon icon={Add01Icon} className="size-4 mr-1.5" />
                Adicionar exceção
              </Button>
            </Empty>
          ) : (
            <div className="space-y-3">
              {overrides.map((override) => (
                <div
                  key={override.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {override.assetTypeName}
                      </span>
                      <Badge variant="secondary">Exceção</Badge>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      {override.temperatureMin != null && (
                        <span>
                          Temp: {override.temperatureMin}–
                          {override.temperatureMax} °C
                        </span>
                      )}
                      {override.humidityMin != null && (
                        <span>
                          Umidade: {override.humidityMin}–
                          {override.humidityMax} %RH
                        </span>
                      )}
                      {override.pressureMin != null && (
                        <span>
                          Pressão: {override.pressureMin}–
                          {override.pressureMax} hPa
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
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
        </CardContent>
      </Card>

      {/* Upsert dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? 'Editar Limites Ambientais'
                : form.assetTypeId != null
                  ? 'Limites por Tipo de Equipamento'
                  : 'Limites Ambientais'}
            </DialogTitle>
            <DialogDescription>
              Defina os limites mínimo e máximo aceitáveis para as condições
              ambientais durante a calibração. Campos em branco não serão
              verificados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Asset type selector (only for new overrides, not for editing or defaults) */}
            {dialogMode === 'override' && !editingId && (
              <Field>
                <FieldLabel>Tipo de Equipamento</FieldLabel>
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
                      : assetTypes.find((at) => at.id === form.assetTypeId)
                            ?.name ?? 'Selecione...'}
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

            {/* Temperature */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={ThermometerIcon}
                  className="size-4 text-orange-500"
                />
                Temperatura (°C)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Mínimo</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 18"
                    value={form.temperatureMin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, temperatureMin: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>Máximo</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 25"
                    value={form.temperatureMax}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, temperatureMax: e.target.value }))
                    }
                  />
                </Field>
              </div>
            </div>

            {/* Humidity */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={DropletIcon}
                  className="size-4 text-blue-500"
                />
                Umidade Relativa (%RH)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Mínimo</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 30"
                    value={form.humidityMin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, humidityMin: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>Máximo</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 70"
                    value={form.humidityMax}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, humidityMax: e.target.value }))
                    }
                  />
                </Field>
              </div>
            </div>

            {/* Pressure */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={CompassIcon}
                  className="size-4 text-purple-500"
                />
                Pressão Atmosférica (hPa)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Mínimo</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 960"
                    value={form.pressureMin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pressureMin: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>Máximo</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 1060"
                    value={form.pressureMax}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pressureMax: e.target.value }))
                    }
                  />
                </Field>
              </div>
            </div>
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
        </>
      )}
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
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      {configured ? (
        <p className="text-sm font-semibold">
          {min} – {max} {unit}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Não configurado</p>
      )}
    </div>
  )
}
