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
  parseFinanceCurrencyInputToCents,
} from '@/lib/finance-formatters'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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

export function NewFinanceDocumentPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<FinanceBillingMode>('single')
  const [eligibleQuery, setEligibleQuery] = useState('')
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([])
  const [dueDate, setDueDate] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
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

      return calibraApi.finance.createDocument<{ data: { id: number } }>({
        mode,
        jobIds: selectedJobIds,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes || undefined,
        discountCents: parseFinanceCurrencyInputToCents(discountAmount),
      })
    },
    onSuccess: (result) => {
      toast.success('Documento financeiro criado')
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
      navigate({
        to: '/dashboard/finance/documents/$id',
        params: { id: String(result.data.id) },
      })
    },
    onError: (error) => toast.error(error.message),
  })

  const discountCents = parseFinanceCurrencyInputToCents(discountAmount)
  const selectedTotal = selectedJobs.reduce(
    (sum, job) => sum + job.priceCents,
    0,
  )
  const documentTotal = Math.max(selectedTotal - discountCents, 0)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/finance/documents' })}
          className="w-fit"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar para documentos
        </Button>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Nova cobrança
          </h2>
          <p className="text-muted-foreground max-w-2xl">
            Selecione OS elegíveis e materialize os itens do documento a partir
            do snapshot comercial congelado.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="space-y-5 rounded-2xl border bg-muted/20 p-5">
            <div className="space-y-1">
              <h3 className="font-medium">Configuração da cobrança</h3>
              <p className="text-muted-foreground text-sm">
                Defina o tipo do documento, vencimento e observações antes de
                selecionar as OS.
              </p>
            </div>

            <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <Field>
                <FieldLabel>Modo</FieldLabel>
                <Select
                  value={mode}
                  onValueChange={(value) => {
                    // oxlint-disable-next-line typescript/consistent-type-assertions -- Select options are limited to billing document modes.
                    setMode(value as 'single' | 'consolidated')
                    setSelectedJobIds([])
                  }}
                >
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
                <Input
                  type="text"
                  inputMode="decimal"
                  value={discountAmount}
                  onChange={(event) => setDiscountAmount(event.target.value)}
                  placeholder="R$ 150,00"
                />
              </Field>
            </FieldGroup>

            <Field>
              <FieldLabel>Observações</FieldLabel>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-28"
                placeholder="Observações internas da cobrança..."
              />
            </Field>
          </section>

          <section className="space-y-4 rounded-2xl border bg-muted/20 p-5">
            <div className="space-y-1">
              <h3 className="font-medium">Resumo financeiro</h3>
              <p className="text-muted-foreground text-sm">
                O total é recalculado conforme as OS selecionadas e o desconto
                informado.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <Card className="shadow-none">
                <CardHeader>
                  <CardDescription>Subtotal</CardDescription>
                  <CardTitle>
                    {formatFinanceMoney(selectedTotal, FINANCE_CURRENCY)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="shadow-none">
                <CardHeader>
                  <CardDescription>Desconto</CardDescription>
                  <CardTitle>
                    {formatFinanceMoney(discountCents, FINANCE_CURRENCY)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="shadow-none">
                <CardHeader>
                  <CardDescription>Total do documento</CardDescription>
                  <CardTitle>
                    {formatFinanceMoney(documentTotal, FINANCE_CURRENCY)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>
          </section>
        </div>

        <section className="flex flex-col space-y-4 rounded-2xl border bg-muted/20 p-5">
          <div className="space-y-1">
            <h3 className="font-medium">OS elegíveis</h3>
            <p className="text-muted-foreground text-sm">
              Apenas jobs aprovados ou retificados sem documento ativo aparecem
              aqui.
            </p>
          </div>

          {eligibleJobsQuery.isError ? (
            <div className="text-destructive text-sm">
              Não foi possível carregar as OS elegíveis.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {(eligibleJobsQuery.data?.data ?? []).length === 0 ? (
                <div className="flex min-h-80 flex-1 items-center justify-center rounded-2xl border border-dashed bg-background/70 p-8 text-center">
                  <div className="max-w-md space-y-2">
                    <h4 className="font-medium">
                      Nenhuma OS elegível no momento
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      {eligibleQuery
                        ? 'Nenhum resultado encontrado para a busca atual. Ajuste o termo pesquisado para localizar outras OS.'
                        : 'Assim que houver ordens aprovadas ou retificadas sem documento ativo, elas aparecerão aqui para seleção.'}
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
                              const next = Boolean(nextChecked)

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
                              <span className="text-muted-foreground text-sm">
                                {job.customerName}
                              </span>
                            </div>
                            <div className="text-muted-foreground mt-1 text-sm">
                              aprovado em{' '}
                              {job.approvedAt
                                ? formatFinanceDate(job.approvedAt)
                                : 'processamento concluído'}
                            </div>
                          </div>

                          <div className="text-muted-foreground min-w-0 text-sm">
                            <div className="font-medium text-foreground">
                              {job.serviceName}
                            </div>
                            <div className="mt-1">{job.unitName}</div>
                          </div>

                          <div className="text-left text-sm xl:text-right">
                            <div className="font-medium">
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
          )}
        </section>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: '/dashboard/finance/documents' })}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Criando...' : 'Criar documento'}
        </Button>
      </div>
    </div>
  )
}
