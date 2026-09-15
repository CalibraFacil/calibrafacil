import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AccreditedScopeLine } from '@calibra-facil/client-runtime'
import {
  unitsForKind,
  canonicalUnitFor,
  quantityKindLabelPt,
  QUANTITY_KIND_OPTIONS_PT,
  type QuantityKind,
} from '@calibra-facil/shared'
import {
  Add01Icon,
  Delete02Icon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useDashboardUnits } from '@/hooks/use-dashboard-units'
import {
  buildScopeLinePayload,
  canSaveScopeLine,
  emptyScopeLineForm,
  formatCmcExpression,
  formatVigencia,
  scopeLineToFormState,
  type ScopeLineFormState,
} from '@/features/settings/accredited-scope-forms'
import { calibraApi } from '@/utils/api'
import { useAccreditedScopeData } from '@/features/settings/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Field, FieldLabel } from '@/components/ui/field'
import { DateInput } from '@/components/ui/date-input'
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

export function AccreditedScopeSettingsPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<ScopeLineFormState>(emptyScopeLineForm)
  const [editingId, setEditingId] = useState<number | null>(null)

  const { isCheckingAccess, isConsolidated, selectedUnit } = useDashboardUnits()

  const { data: scopeData, isLoading } = useAccreditedScopeData({
    enabled: Boolean(selectedUnit),
    unitId: typeof selectedUnit?.id === 'number' ? selectedUnit.id : null,
  })

  const lines = scopeData?.lines ?? []

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['accredited-scope', selectedUnit?.id ?? 'no-unit'],
    })

  const saveMutation = useMutation({
    mutationFn: async (data: ScopeLineFormState) => {
      const built = buildScopeLinePayload(data, editingId)
      if (!built.ok) throw new Error(built.error)
      return calibraApi.accreditedScope.save(built.payload)
    },
    onSuccess: () => {
      invalidate()
      toast.success('Linha de escopo salva')
      setDialogOpen(false)
      setForm(emptyScopeLineForm)
      setEditingId(null)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar a linha',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => calibraApi.accreditedScope.delete(id),
    onSuccess: () => {
      invalidate()
      toast.success('Linha de escopo removida')
    },
    onError: () => {
      toast.error('Erro ao remover a linha')
    },
  })

  const enforcementMutation = useMutation({
    mutationFn: async (mode: 'warn' | 'enforce') =>
      calibraApi.accreditedScope.setEnforcementMode(mode),
    onSuccess: (result) => {
      invalidate()
      toast.success(result.message)
    },
    onError: () => {
      toast.error('Erro ao alterar o modo da guarda')
    },
  })

  function openNewDialog() {
    setForm(emptyScopeLineForm)
    setEditingId(null)
    setDialogOpen(true)
  }

  function openEditDialog(line: AccreditedScopeLine) {
    setForm(scopeLineToFormState(line))
    setEditingId(line.id)
    setDialogOpen(true)
  }

  function changeQuantityKind(kind: QuantityKind) {
    const canonical = canonicalUnitFor(kind)
    setForm((f) => ({
      ...f,
      quantityKind: kind,
      rangeUnit: canonical,
      cmcUnit: canonical,
    }))
  }

  const kindUnits = unitsForKind(form.quantityKind)
  const canSave = canSaveScopeLine(form)

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
            Escopo acreditado (CMC)
          </h2>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Linhas do escopo publicado pela Cgcre: grandeza, faixa e a menor
            incerteza que o laboratório pode declarar (CMC). Certificados
            acreditados são verificados contra estas linhas na submissão e na
            assinatura.
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
            switcher para editar o escopo acreditado dela.
          </p>
        </Panel>
      ) : !selectedUnit ? (
        <Panel className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade ativa encontrada para esta organização.
          </p>
        </Panel>
      ) : (
        <>
          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Guarda de emissão"
              description="Como o sistema reage quando um certificado acreditado viola o escopo: ponto fora de faixa ou incerteza menor que a CMC."
            />
            <div className="mt-4 max-w-sm">
              <Select
                value={scopeData?.enforcementMode ?? 'warn'}
                onValueChange={(value) => {
                  if (value === 'warn' || value === 'enforce') {
                    enforcementMutation.mutate(value)
                  }
                }}
              >
                <SelectTrigger disabled={enforcementMutation.isPending}>
                  {scopeData?.enforcementMode === 'enforce'
                    ? 'Bloquear emissão acreditada'
                    : 'Apenas avisar'}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warn">Apenas avisar</SelectItem>
                  <SelectItem value="enforce">
                    Bloquear emissão acreditada
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                No modo bloqueio, a aprovação só passa com justificativa
                documentada e o certificado sai sem o selo de acreditação.
                Comece no modo aviso e ative o bloqueio depois de validar as
                linhas do escopo.
              </p>
            </div>
          </Panel>
          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Linhas de escopo"
              description="Uma linha por grandeza e faixa, com a CMC declarada em k=2. Faixas com CMC em degraus entram como linhas separadas."
              action={
                lines.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={openNewDialog}>
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
              ) : lines.length === 0 ? (
                <Empty>
                  <EmptyMedia>
                    <HugeiconsIcon
                      icon={SecurityCheckIcon}
                      className="size-8 text-muted-foreground"
                    />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>Nenhuma linha de escopo cadastrada</EmptyTitle>
                    <EmptyDescription>
                      Sem linhas cadastradas, os certificados acreditados são
                      emitidos sem verificação de escopo e CMC.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button variant="outline" size="sm" onClick={openNewDialog}>
                    <HugeiconsIcon icon={Add01Icon} className="mr-1.5 size-4" />
                    Adicionar linha
                  </Button>
                </Empty>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => {
                    const vigencia = formatVigencia(line)
                    return (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">
                              {quantityKindLabelPt(line.quantityKind)}
                            </span>
                            {line.description ? (
                              <span className="truncate text-sm text-muted-foreground">
                                {line.description}
                              </span>
                            ) : null}
                            {vigencia ? (
                              <Badge variant="secondary">{vigencia}</Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
                            <span>
                              Faixa {line.rangeMin} – {line.rangeMax}{' '}
                              {line.rangeUnit}
                            </span>
                            <span>CMC {formatCmcExpression(line)}</span>
                            <span>k={line.coverageFactor}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(line)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deleteMutation.mutate(line.id)}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="size-4 text-destructive"
                            />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Panel>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar linha de escopo' : 'Nova linha de escopo'}
            </DialogTitle>
            <DialogDescription>
              Copie os valores da linha correspondente do escopo publicado pela
              Cgcre. A CMC vale para k=2.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Grandeza</FieldLabel>
                <Select
                  value={form.quantityKind}
                  onValueChange={(value) => {
                    const match = QUANTITY_KIND_OPTIONS_PT.find(
                      (option) => option.value === value,
                    )
                    if (match) changeQuantityKind(match.value)
                  }}
                >
                  <SelectTrigger>
                    {quantityKindLabelPt(form.quantityKind)}
                  </SelectTrigger>
                  <SelectContent>
                    {QUANTITY_KIND_OPTIONS_PT.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Descrição (opcional)</FieldLabel>
                <Input
                  placeholder="Ex: Balanças classe II"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel>Faixa: de</FieldLabel>
                <Input
                  type="number"
                  placeholder="Ex: 0"
                  value={form.rangeMin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, rangeMin: e.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>até</FieldLabel>
                <Input
                  type="number"
                  placeholder="Ex: 500"
                  value={form.rangeMax}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, rangeMax: e.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Unidade</FieldLabel>
                <Select
                  value={form.rangeUnit}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, rangeUnit: value ?? f.rangeUnit }))
                  }
                >
                  <SelectTrigger>{form.rangeUnit}</SelectTrigger>
                  <SelectContent>
                    {kindUnits.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel>Tipo de CMC</FieldLabel>
                <Select
                  value={form.cmcType}
                  onValueChange={(value) =>
                    setForm((f) => ({
                      ...f,
                      cmcType: value === 'linear' ? 'linear' : 'fixed',
                    }))
                  }
                >
                  <SelectTrigger>
                    {form.cmcType === 'linear'
                      ? 'Fórmula (a + b·x)'
                      : 'Valor fixo'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Valor fixo</SelectItem>
                    <SelectItem value="linear">Fórmula (a + b·x)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>
                  {form.cmcType === 'linear' ? 'Termo fixo (a)' : 'CMC'}
                </FieldLabel>
                <Input
                  type="number"
                  step="any"
                  placeholder="Ex: 0,01"
                  value={form.cmcA}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cmcA: e.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Unidade</FieldLabel>
                <Select
                  value={form.cmcUnit}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, cmcUnit: value ?? f.cmcUnit }))
                  }
                >
                  <SelectTrigger>{form.cmcUnit}</SelectTrigger>
                  <SelectContent>
                    {kindUnits.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {form.cmcType === 'linear' ? (
              <Field>
                <FieldLabel>Coeficiente por unidade de leitura (b)</FieldLabel>
                <Input
                  type="number"
                  step="any"
                  placeholder="Ex: 0,0001"
                  value={form.cmcB}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cmcB: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  CMC(x) = a + b·x, com x em {form.rangeUnit} e o resultado em{' '}
                  {form.cmcUnit}, ou seja, b em {form.cmcUnit} por{' '}
                  {form.rangeUnit}.{' '}
                  {form.cmcUnit === form.rangeUnit
                    ? 'Para CMC percentual da leitura, use a = 0 e b igual à fração (0,02% = 0,0002).'
                    : 'Com unidades diferentes, converta a fração percentual para essas unidades antes de preencher b.'}
                </p>
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Vigente de (opcional)</FieldLabel>
                <DateInput
                  value={form.validFrom}
                  onChange={(date) =>
                    setForm((f) => ({ ...f, validFrom: date }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Vigente até (opcional)</FieldLabel>
                <DateInput
                  value={form.validUntil}
                  onChange={(date) =>
                    setForm((f) => ({ ...f, validUntil: date }))
                  }
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
