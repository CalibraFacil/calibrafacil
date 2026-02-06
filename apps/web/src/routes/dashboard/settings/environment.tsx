import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ThermometerIcon,
  Add01Icon,
  Delete02Icon,
  DropletIcon,
  CompassIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
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

interface EnvironmentalLimit {
  id: number
  assetTypeId: number | null
  assetTypeName: string | null
  temperatureMin: number | null
  temperatureMax: number | null
  humidityMin: number | null
  humidityMax: number | null
  pressureMin: number | null
  pressureMax: number | null
}

interface AssetType {
  id: number
  name: string
  slug: string
}

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

  // Fetch all limits
  const { data: limitsData, isLoading } = useQuery({
    queryKey: ['environmental-limits'],
    queryFn: async () => {
      const res = await api.api['environmental-limits'].$get()
      if (!res.ok) throw new Error('Falha ao carregar limites')
      return res.json() as Promise<{ limits: EnvironmentalLimit[] }>
    },
  })

  // Fetch asset types
  const { data: assetTypesData } = useQuery({
    queryKey: ['asset-types'],
    queryFn: async () => {
      const res = await api.api['asset-types'].$get({ query: {} })
      if (!res.ok) throw new Error('Falha ao carregar tipos')
      return res.json() as Promise<{ data: AssetType[] }>
    },
    staleTime: 60000,
  })

  const limits = limitsData?.limits ?? []
  const assetTypes = assetTypesData?.data ?? []

  // Separate org default from asset-type overrides
  const orgDefault = limits.find((l) => l.assetTypeId === null)
  const overrides = limits.filter((l) => l.assetTypeId !== null)

  // Upsert mutation
  const upsertMutation = useMutation({
    mutationFn: async (data: LimitFormState) => {
      const res = await api.api['environmental-limits'].$put({
        json: {
          assetTypeId: data.assetTypeId,
          temperatureMin: data.temperatureMin ? Number(data.temperatureMin) : null,
          temperatureMax: data.temperatureMax ? Number(data.temperatureMax) : null,
          humidityMin: data.humidityMin ? Number(data.humidityMin) : null,
          humidityMax: data.humidityMax ? Number(data.humidityMax) : null,
          pressureMin: data.pressureMin ? Number(data.pressureMin) : null,
          pressureMax: data.pressureMax ? Number(data.pressureMax) : null,
        },
      })
      if (!res.ok) throw new Error('Falha ao salvar')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environmental-limits'] })
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
      const res = await api.api['environmental-limits'][':id'].$delete({
        param: { id: String(id) },
      })
      if (!res.ok) throw new Error('Falha ao remover')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environmental-limits'] })
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
    setDialogOpen(true)
  }

  function openNewOverrideDialog() {
    setForm(emptyForm)
    setEditingId(null)
    setDialogOpen(true)
  }

  function openDefaultDialog() {
    if (orgDefault) {
      openEditDialog(orgDefault)
    } else {
      setForm(emptyForm)
      setEditingId(null)
      setDialogOpen(true)
    }
  }

  // Asset types that already have overrides
  const usedAssetTypeIds = new Set(overrides.map((o) => o.assetTypeId))
  const availableAssetTypes = assetTypes.filter(
    (at) => !usedAssetTypeIds.has(at.id),
  )

  return (
    <div className="space-y-6">
      {/* Default limits */}
      <Card>
        <CardHeader>
          <CardTitle>Limites Padrão</CardTitle>
          <CardDescription>
            Limites ambientais padrão aplicados a todas as calibrações da
            organização. Tipos de equipamento podem ter limites específicos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : orgDefault ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <LimitDisplay
                  icon={ThermometerIcon}
                  label="Temperatura"
                  min={orgDefault.temperatureMin}
                  max={orgDefault.temperatureMax}
                  unit="°C"
                />
                <LimitDisplay
                  icon={DropletIcon}
                  label="Umidade"
                  min={orgDefault.humidityMin}
                  max={orgDefault.humidityMax}
                  unit="%RH"
                />
                <LimitDisplay
                  icon={CompassIcon}
                  label="Pressão"
                  min={orgDefault.pressureMin}
                  max={orgDefault.pressureMax}
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
                sem verificação de condições ambientais.
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
                determinados tipos de instrumento.
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
                  organização.
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
            {/* Asset type selector (only for new overrides, not for default) */}
            {!editingId && !orgDefault && form.assetTypeId == null ? null : null}
            {!editingId && (
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
