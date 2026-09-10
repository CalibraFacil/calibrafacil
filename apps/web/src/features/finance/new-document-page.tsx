import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'

import {
  FINANCE_CURRENCY,
  formatFinanceDate,
  formatFinanceMoney,
  getBillingModeLabel,
} from '@/lib/finance-formatters'
import { Panel, PanelHeader, SignalTile } from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CurrencyInput } from '@/components/ui/currency-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { calibraApi } from '@/utils/api'
import { useFinanceEligibleJobsData } from '@/features/finance/queries'
import type { FinanceBillingMode } from '@/features/finance/types'

function asBillingMode(value: string): FinanceBillingMode {
  return value === 'consolidated' ? 'consolidated' : 'single'
}

export function NewFinanceDocumentPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<FinanceBillingMode>('single')
  const [pendingMode, setPendingMode] = useState<FinanceBillingMode | null>(
    null,
  )
  const [eligibleQuery, setEligibleQuery] = useState('')
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([])
  const [dueDate, setDueDate] = useState('')
  const [discountCents, setDiscountCents] = useState(0)
  const [notes, setNotes] = useState('')

  const eligibleJobsQuery = useFinanceEligibleJobsData({
    mode,
    search: eligibleQuery,
  })

  const selectedJobs = useMemo(
    () =>
      (eligibleJobsQuery.data?.data ?? []).filter((job) =>
        selectedJobIds.includes(job.id),
      ),
    [eligibleJobsQuery.data, selectedJobIds],
  )

  const createMutation = useMutation({
    mutationFn: async () => {
      if (selectedJobIds.length === 0) {
        throw new Error('Selecione pelo menos uma OS elegível')
      }
      return calibraApi.finance.createDocument<{
        data: { id: number; publicId: string }
      }>({
        mode,
        jobIds: selectedJobIds,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes || undefined,
        discountCents,
      })
    },
    onSuccess: (result) => {
      toast.success('Documento financeiro criado')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'documents'],
        refetchType: 'active',
      })
      queryClient.invalidateQueries({
        queryKey: ['finance', 'overview'],
        refetchType: 'active',
      })
      navigate({
        to: '/dashboard/finance/documents/$id',
        params: { id: result.data.publicId },
      })
    },
    onError: (error) => toast.error(error.message),
  })

  const selectedTotal = selectedJobs.reduce(
    (sum, job) => sum + job.priceCents,
    0,
  )
  const documentTotal = Math.max(selectedTotal - discountCents, 0)

  function requestModeChange(value: string | null) {
    if (value === null) return
    const next = asBillingMode(value)
    if (next === mode) return
    if (selectedJobIds.length > 0) {
      setPendingMode(next)
      return
    }
    setMode(next)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/finance/receivables' })}
          className="w-fit"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar para recebíveis
        </Button>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Nova cobrança
          </h2>
          <p className="max-w-2xl text-muted-foreground">
            Selecione OS elegíveis e materialize os itens do documento a partir
            do snapshot comercial congelado.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel className="p-5">
            <PanelHeader
              eyebrow="Configuração"
              title="Parâmetros da cobrança"
              description="Defina o tipo, vencimento e desconto antes de selecionar as OS."
            />
            <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <Field>
                <FieldLabel>Modo</FieldLabel>
                <Select value={mode} onValueChange={requestModeChange}>
                  <SelectTrigger className="w-full">
                    <span>{getBillingModeLabel(mode)}</span>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="single">Por OS</SelectItem>
                    <SelectItem value="consolidated">Consolidada</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Pesquisar OS</FieldLabel>
                <Input
                  value={eligibleQuery}
                  onChange={(event) => setEligibleQuery(event.target.value)}
                  placeholder="Ex: JOB-2026-001"
                />
              </Field>

              <Field>
                <FieldLabel>Vencimento manual</FieldLabel>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel>Desconto</FieldLabel>
                <CurrencyInput
                  valueCents={discountCents}
                  onValueChange={setDiscountCents}
                  currency={FINANCE_CURRENCY}
                />
              </Field>
            </FieldGroup>

            <Field className="mt-4">
              <FieldLabel>Observações</FieldLabel>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-28"
                placeholder="Observações internas da cobrança…"
              />
            </Field>
          </Panel>

          <Panel className="p-5">
            <PanelHeader
              eyebrow="Resumo"
              title="Total da cobrança"
              description="Recalculado conforme as OS selecionadas e o desconto."
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <SignalTile
                label="Subtotal"
                value={formatFinanceMoney(selectedTotal, FINANCE_CURRENCY)}
                hint={`${selectedJobs.length} OS`}
                tone="neutral"
              />
              <SignalTile
                label="Desconto"
                value={formatFinanceMoney(discountCents, FINANCE_CURRENCY)}
                tone={discountCents > 0 ? 'info' : 'neutral'}
              />
              <SignalTile
                label="Total do documento"
                value={formatFinanceMoney(documentTotal, FINANCE_CURRENCY)}
                tone="ok"
              />
            </div>
          </Panel>
        </div>

        <Panel className="flex flex-col p-5">
          <PanelHeader
            eyebrow="Seleção"
            title="OS elegíveis"
            description="Apenas jobs aprovados ou retificados sem documento ativo."
          />

          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {eligibleJobsQuery.isError ? (
              <p className="text-sm text-destructive">
                Não foi possível carregar as OS elegíveis.
              </p>
            ) : (eligibleJobsQuery.data?.data ?? []).length === 0 ? (
              <div className="flex min-h-80 flex-1 items-center justify-center rounded-2xl border border-dashed bg-background/70 p-8 text-center">
                <div className="max-w-md space-y-2">
                  <h4 className="font-medium">Nenhuma OS elegível</h4>
                  <p className="text-sm text-muted-foreground">
                    {eligibleQuery
                      ? 'Nenhum resultado para a busca atual. Ajuste o termo pesquisado.'
                      : 'Assim que houver ordens aprovadas ou retificadas sem documento ativo, elas aparecerão aqui.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {(eligibleJobsQuery.data?.data ?? []).map((job) => {
                  const checked = selectedJobIds.includes(job.id)
                  return (
                    <label
                      key={job.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/30"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          setSelectedJobIds((current) => {
                            const next = nextChecked === true
                            if (mode === 'single') {
                              return next ? [job.id] : []
                            }
                            return next
                              ? [...new Set([...current, job.id])]
                              : current.filter((entry) => entry !== job.id)
                          })
                        }}
                      />
                      <div className="grid min-w-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px] xl:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{job.jobId}</span>
                            <span className="text-sm text-muted-foreground">
                              {job.customerName}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            aprovado em{' '}
                            {job.approvedAt
                              ? formatFinanceDate(job.approvedAt)
                              : 'processamento concluído'}
                          </div>
                        </div>
                        <div className="min-w-0 text-sm text-muted-foreground">
                          <div className="font-medium text-foreground">
                            {job.serviceName}
                          </div>
                          <div className="mt-1">{job.unitName}</div>
                        </div>
                        <div className="text-left text-sm xl:text-right">
                          <div className="font-mono font-medium tabular-nums">
                            {formatFinanceMoney(job.priceCents, job.currency)}
                          </div>
                          <div className="text-muted-foreground">
                            prazo {job.paymentTermDays} dias
                          </div>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: '/dashboard/finance/receivables' })}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || selectedJobIds.length === 0}
        >
          {createMutation.isPending ? 'Criando…' : 'Criar documento'}
        </Button>
      </div>

      <Dialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMode(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar o modo da cobrança?</DialogTitle>
            <DialogDescription>
              Alternar entre cobrança por OS e consolidada limpará as{' '}
              {selectedJobIds.length} OS já selecionadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingMode(null)}
            >
              Manter seleção
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingMode) {
                  setMode(pendingMode)
                  setSelectedJobIds([])
                  setPendingMode(null)
                }
              }}
            >
              Trocar e limpar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
