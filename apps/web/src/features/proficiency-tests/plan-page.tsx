import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft02Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import {
  parsePtPlanItemForm,
  type PtPlanItemFormData,
} from '@/features/proficiency-tests/forms'
import {
  useCreatePtPlanItem,
  usePtPlanData,
  useRemovePtPlanItem,
} from '@/features/proficiency-tests/queries'
import type { PtPlanItem } from '@/features/proficiency-tests/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

const DUE_SOON_WINDOW_DAYS = 90

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

type DueState = 'overdue' | 'due_soon' | 'ok' | 'unscheduled'

function dueState(item: PtPlanItem): DueState {
  if (!item.nextDueAt) return 'unscheduled'
  const due = new Date(item.nextDueAt)
  const now = new Date()
  if (due < now) return 'overdue'
  const soon = new Date(now)
  soon.setDate(soon.getDate() + DUE_SOON_WINDOW_DAYS)
  if (due <= soon) return 'due_soon'
  return 'ok'
}

export function ProficiencyTestPlanPage() {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [lastSatisfactoryAt, setLastSatisfactoryAt] = useState<
    Date | undefined
  >(undefined)

  const organizationId = activeOrganizationId ?? 'no-org'
  const canLoad =
    !cloudOnlyUnavailable &&
    Boolean(activeOrganizationId) &&
    !isContextSwitching

  const { data, isLoading, error } = usePtPlanData({
    organizationId,
    enabled: canLoad,
  })

  const createMutation = useCreatePtPlanItem()
  const removeMutation = useRemovePtPlanItem()

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PtPlanItemFormData>({
    defaultValues: {
      scopePart: '',
      riskJustification: '',
      frequencyMonths: '48',
    },
  })

  const onSubmit = (formData: PtPlanItemFormData) => {
    const parsed = parsePtPlanItemForm(formData, lastSatisfactoryAt)
    if (!parsed.success) {
      for (const issue of parsed.fieldErrors) {
        setError(issue.field, { type: 'validate', message: issue.message })
      }

      toast.error(parsed.message)
      return
    }

    createMutation.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Item adicionado ao plano de participação')
        reset()
        setLastSatisfactoryAt(undefined)
      },
      onError: (mutationError) => {
        toast.error(mutationError.message)
      },
    })
  }

  const handleRemove = (item: PtPlanItem) => {
    removeMutation.mutate(item.id, {
      onSuccess: () => {
        toast.success(`Item "${item.scopePart}" removido do plano`)
      },
      onError: (mutationError) => {
        toast.error(mutationError.message)
      },
    })
  }

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Plano de participação indisponível offline" />
    )
  }

  if (isContextSwitching) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Carregando o contexto da organização ativa.
        </p>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar o plano de participação: {error.message}
        </p>
      </Panel>
    )
  }

  const items = data?.data ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Qualidade
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Plano de participação em EP
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Cada parte do escopo deve ter participação satisfatória dentro da
            frequência planejada (padrão: ciclo de 4 anos).
          </p>
        </div>
        <Button
          variant="outline"
          render={<Link to="/dashboard/proficiency-tests" />}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} className="mr-2 size-4" />
          Ensaios de proficiência
        </Button>
      </div>

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Itens do plano"
          description="Vencimentos calculados a partir da última participação satisfatória."
        />
        <div className="mt-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Carregando...
            </p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
              Nenhuma parte do escopo planejada ainda. Adicione a primeira
              abaixo.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Parte do escopo
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                      Frequência
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Última satisfatória
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Próximo vencimento
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Situação
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const state = dueState(item)
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{item.scopePart}</div>
                          {item.riskJustification && (
                            <div className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                              {item.riskJustification}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {item.frequencyMonths} meses
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          {formatDate(item.lastSatisfactoryAt)}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          <span
                            className={
                              state === 'overdue'
                                ? 'font-medium text-destructive'
                                : state === 'due_soon'
                                  ? 'font-medium text-amber-700 dark:text-amber-400'
                                  : ''
                            }
                          >
                            {formatDate(item.nextDueAt)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {state === 'overdue' ? (
                            <Badge variant="destructive">Vencido</Badge>
                          ) : state === 'due_soon' ? (
                            <Badge
                              variant="outline"
                              className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                            >
                              Vence em breve
                            </Badge>
                          ) : state === 'ok' ? (
                            <Badge
                              variant="outline"
                              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            >
                              Em dia
                            </Badge>
                          ) : (
                            <Badge variant="outline">Sem histórico</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(item)}
                            disabled={removeMutation.isPending}
                            aria-label={`Remover ${item.scopePart}`}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="size-4"
                            />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Adicionar parte do escopo"
          description="Defina a frequência de participação com base no risco da atividade."
        />
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="scopePart">Parte do escopo</Label>
              <Input
                {...register('scopePart', {
                  required: 'Parte do escopo é obrigatória',
                  minLength: {
                    value: 2,
                    message: 'Escopo deve ter pelo menos 2 caracteres',
                  },
                })}
                placeholder="Ex: Massa — pesos classe M1"
              />
              {errors.scopePart && (
                <p className="text-sm text-destructive">
                  {errors.scopePart.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="frequencyMonths">Frequência (meses)</Label>
              <Input
                {...register('frequencyMonths')}
                inputMode="numeric"
                placeholder="48"
              />
              {errors.frequencyMonths && (
                <p className="text-sm text-destructive">
                  {errors.frequencyMonths.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Última participação satisfatória (opcional)</Label>
              <DatePicker
                value={lastSatisfactoryAt}
                onChange={setLastSatisfactoryAt}
                placeholder="Selecione a data"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="riskJustification">
              Justificativa de risco (opcional)
            </Label>
            <Textarea
              {...register('riskJustification')}
              placeholder="Justifique a frequência escolhida com base no risco, volume e criticidade da atividade..."
              rows={2}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              className={ACTION_BUTTON_CLASS}
              disabled={createMutation.isPending}
            >
              <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
              {createMutation.isPending
                ? 'Adicionando...'
                : 'Adicionar ao plano'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
