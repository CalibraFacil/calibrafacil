import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Invoice02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  BillingDocumentStatusBadge,
  ExportStatusBadge,
  formatFinanceDate,
  formatFinanceMoney,
} from '@/components/finance/finance-ui'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/utils/api'

type BillingDocumentListItem = {
  id: number
  documentNumber: string | null
  status: string
  customerId: number
  customerName: string
  unitId: number
  unitName: string
  issueDate: string | null
  dueDate: string
  subtotalCents: number
  discountCents: number
  totalCents: number
  currency: string
  exportStatus: string
  exportedAt: string | null
}

type EligibleJob = {
  id: number
  jobId: string
  customerId: number
  customerName: string
  unitId: number
  unitName: string
  serviceId: number
  serviceName: string
  approvedAt: string | null
  priceCents: number
  currency: string
  paymentTermDays: number
  snapshotId: number
}

function getBillingModeLabel(mode: 'single' | 'consolidated') {
  return mode === 'single' ? 'Por OS' : 'Consolidada'
}

function parseCurrencyInputToCents(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const parsed = Number.parseFloat(normalized)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return Math.round(parsed * 100)
}

const FINANCE_CURRENCY = 'BRL'
const FINANCE_CURRENCY_LABEL = 'R$'

export const Route = createFileRoute('/dashboard/finance/documents')({
  head: () => ({
    meta: [{ title: 'Documentos financeiros | CalibraFácil' }],
  }),
  component: FinanceDocumentsPage,
})

function FinanceDocumentsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'single' | 'consolidated'>('single')
  const [eligibleQuery, setEligibleQuery] = useState('')
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([])
  const [dueDate, setDueDate] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [notes, setNotes] = useState('')

  const documentsQuery = useQuery({
    queryKey: ['finance', 'documents', query],
    queryFn: async () => {
      const response = await api.api.finance.documents.$get({
        query: { query: query || undefined },
      })
      if (!response.ok) {
        throw new Error('Erro ao carregar documentos')
      }

      return response.json() as Promise<{ data: BillingDocumentListItem[] }>
    },
  })

  const eligibleJobsQuery = useQuery({
    queryKey: ['finance', 'documents', 'eligible-jobs', dialogOpen, mode, eligibleQuery],
    enabled: dialogOpen,
    queryFn: async () => {
      const response = await api.api.finance.documents['eligible-jobs'].$get({
        query: {
          mode,
          query: eligibleQuery || undefined,
          limit: '100',
        },
      })
      if (!response.ok) {
        throw new Error('Erro ao carregar OS elegíveis')
      }

      return response.json() as Promise<{ data: EligibleJob[] }>
    },
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

      const response = await api.api.finance.documents.$post({
        json: {
          mode,
          jobIds: selectedJobIds,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
          notes: notes || undefined,
          discountCents: parseCurrencyInputToCents(discountAmount),
        },
      })

      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || 'Erro ao criar documento')
      }

      return response.json()
    },
    onSuccess: (result) => {
      toast.success('Documento financeiro criado')
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
      const documentId =
        typeof (result as { data?: { id?: unknown } }).data?.id === 'number'
          ? (result as { data: { id: number } }).data.id
          : null

      setDialogOpen(false)
      setSelectedJobIds([])
      setDueDate('')
      setNotes('')
      setDiscountAmount('')
      setEligibleQuery('')

      if (documentId) {
        navigate({
          to: '/dashboard/finance/documents/$id',
          params: { id: String(documentId) },
        })
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const discountCents = parseCurrencyInputToCents(discountAmount)
  const selectedTotal = selectedJobs.reduce((sum, job) => sum + job.priceCents, 0)
  const documentCurrency = FINANCE_CURRENCY
  const documentTotal = Math.max(selectedTotal - discountCents, 0)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Documentos financeiros</CardTitle>
            <CardDescription>
              Emita cobranças por OS ou de forma consolidada a partir de ordens
              aprovadas.
            </CardDescription>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Nova cobrança
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-sm">
            <Input
              placeholder="Buscar por cliente ou número"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {documentsQuery.isError ? (
            <div className="text-destructive text-sm">
              Não foi possível carregar os documentos.
            </div>
          ) : documentsQuery.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Exportação</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documentsQuery.data.data.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <Link
                        to="/dashboard/finance/documents/$id"
                        params={{ id: String(document.id) }}
                        className="font-medium hover:underline"
                      >
                        {document.documentNumber ?? `Rascunho #${document.id}`}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {document.unitName}
                      </div>
                    </TableCell>
                    <TableCell>{document.customerName}</TableCell>
                    <TableCell>
                      <BillingDocumentStatusBadge status={document.status} />
                    </TableCell>
                    <TableCell>
                      <ExportStatusBadge status={document.exportStatus} />
                    </TableCell>
                    <TableCell>{formatFinanceDate(document.dueDate)}</TableCell>
                    <TableCell className="text-right">
                      {formatFinanceMoney(document.totalCents, document.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Invoice02Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum documento criado</EmptyTitle>
                <EmptyDescription>
                  Selecione OS aprovadas e gere a primeira cobrança do módulo.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>Nova cobrança</DialogTitle>
            <DialogDescription>
              Selecione OS elegíveis e materialize os itens do documento a
              partir do snapshot comercial congelado.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(92vh-9.5rem)] overflow-y-auto px-6 py-5">
            <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
              <div className="space-y-6">
                <section className="space-y-5 rounded-2xl border bg-muted/20 p-5">
                  <div className="space-y-1">
                    <h3 className="font-medium">Configuração da cobrança</h3>
                    <p className="text-muted-foreground text-sm">
                      Defina o tipo do documento, vencimento e observações
                      antes de selecionar as OS.
                    </p>
                  </div>

                  <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                    <Field>
                      <FieldLabel>Modo</FieldLabel>
                      <Select
                        value={mode}
                        onValueChange={(value) => {
                          setMode(value as 'single' | 'consolidated')
                          setSelectedJobIds([])
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <span>{getBillingModeLabel(mode)}</span>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="single">Por OS</SelectItem>
                          <SelectItem value="consolidated">
                            Consolidada
                          </SelectItem>
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
                        placeholder="0,00"
                      />
                      <FieldDescription>
                        Informe o valor do desconto em {FINANCE_CURRENCY_LABEL},
                        por
                        exemplo 150,00.
                      </FieldDescription>
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
                      O total é recalculado conforme as OS selecionadas e o
                      desconto informado.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardDescription>Subtotal</CardDescription>
                        <CardTitle>
                          {formatFinanceMoney(selectedTotal, documentCurrency)}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardDescription>Desconto</CardDescription>
                        <CardTitle>
                          {formatFinanceMoney(discountCents, documentCurrency)}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardDescription>Total do documento</CardDescription>
                        <CardTitle>
                          {formatFinanceMoney(documentTotal, documentCurrency)}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  </div>
                </section>
              </div>

              <section className="flex min-h-[640px] flex-col space-y-4 rounded-2xl border bg-muted/20 p-5">
                <div className="space-y-1">
                  <h3 className="font-medium">OS elegíveis</h3>
                  <p className="text-muted-foreground text-sm">
                    Apenas jobs aprovados ou retificados sem documento ativo
                    aparecem aqui.
                  </p>
                </div>

                {eligibleJobsQuery.isError ? (
                  <div className="text-destructive text-sm">
                    Não foi possível carregar as OS elegíveis.
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {(eligibleJobsQuery.data?.data ?? []).length === 0 ? (
                      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed bg-background/70 p-8 text-center">
                        <div className="max-w-md space-y-2">
                          <h4 className="font-medium">Nenhuma OS elegível no momento</h4>
                          <p className="text-muted-foreground text-sm">
                            {eligibleQuery
                              ? 'Nenhum resultado encontrado para a busca atual. Ajuste o termo pesquisado para localizar outras OS.'
                              : 'Assim que houver ordens aprovadas ou retificadas sem documento ativo, elas aparecerão aqui para seleção.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 overflow-y-auto pr-1">
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
          </div>

          <DialogFooter className="border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
