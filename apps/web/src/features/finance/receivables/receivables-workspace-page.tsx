import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusSignIcon, SentIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import {
  type FinancialPaymentMethod,
  getBillingDocumentStatusLabel,
  getReceivableInstallmentStatusLabel,
} from '@calibra-facil/shared'

import {
  BillingDocumentStatusBadge,
  ExportStatusBadge,
} from '@/components/finance-status-badges'
import { formatFinanceDate } from '@/lib/finance-formatters'
import {
  Money,
  billingDocumentToneOf,
  installmentToneOf,
} from '@/features/finance/finance-display'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  FinanceDataTable,
  type FacetConfig,
} from '@/features/finance/components/finance-data-table'
import {
  useFinanceDocumentsData,
  useFinanceReceiptsData,
} from '@/features/finance/queries'
import {
  useExportErpDocumentMutation,
  useIssueDocumentMutation,
  useReceiveInstallmentMutation,
} from '@/features/finance/mutations'
import type {
  BillingDocumentListItem,
  ReceiptRow,
} from '@/features/finance/types'
import type { ReceivablesSearch } from '@/features/finance/receivables/receivables-search'

const PAYMENT_METHODS: readonly FinancialPaymentMethod[] = [
  'BANK_TRANSFER',
  'PIX',
  'BOLETO',
  'CREDIT_CARD',
  'CASH',
  'OTHER',
]

const PAYMENT_METHOD_LABELS: Record<FinancialPaymentMethod, string> = {
  BANK_TRANSFER: 'Transferência bancária',
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
  CASH: 'Dinheiro',
  OTHER: 'Outro',
}

function parsePaymentMethod(value: string): FinancialPaymentMethod {
  return PAYMENT_METHODS.find((method) => method === value) ?? 'BANK_TRANSFER'
}

async function runBulkFinance(
  ids: number[],
  action: (id: number) => Promise<unknown>,
  label: string,
  clear: () => void,
) {
  if (ids.length === 0) return
  const results = await Promise.allSettled(ids.map((id) => action(id)))
  const ok = results.filter((result) => result.status === 'fulfilled').length
  if (ok > 0) {
    const { toast } = await import('sonner')
    toast.success(`${label}: ${ok} de ${ids.length}`)
  }
  clear()
}

const DOCUMENT_FACETS: FacetConfig[] = [
  {
    columnId: 'status',
    title: 'Status',
    options: (['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID'] as const).map(
      (value) => ({ value, label: getBillingDocumentStatusLabel(value) }),
    ),
  },
  {
    columnId: 'exportStatus',
    title: 'Exportação',
    options: [
      { value: 'NOT_EXPORTED', label: 'Não exportado' },
      { value: 'PENDING', label: 'Pendente' },
      { value: 'EXPORTED', label: 'Exportado' },
      { value: 'FAILED', label: 'Falhou' },
    ],
  },
]

const INSTALLMENT_FACETS: FacetConfig[] = [
  {
    columnId: 'installmentStatus',
    title: 'Situação',
    options: (['OPEN', 'OVERDUE', 'PAID', 'VOID'] as const).map((value) => ({
      value,
      label: getReceivableInstallmentStatusLabel(value),
    })),
  },
]

const documentColumns: ColumnDef<BillingDocumentListItem, unknown>[] = [
  {
    accessorKey: 'documentNumber',
    id: 'documentNumber',
    header: 'Documento',
    enableHiding: false,
    cell: ({ row }) => (
      <div>
        <Link
          to="/dashboard/finance/documents/$id"
          params={{ id: row.original.publicId }}
          className="font-medium hover:underline"
        >
          {row.original.documentNumber ?? `Rascunho #${row.original.id}`}
        </Link>
        <div className="text-xs text-muted-foreground">
          {row.original.unitName}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'customerName',
    id: 'customerName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cliente" />
    ),
    meta: { label: 'Cliente' },
  },
  {
    accessorKey: 'status',
    id: 'status',
    header: 'Status',
    filterFn: 'arrIncludesSome',
    meta: { label: 'Status' },
    cell: ({ row }) => (
      <BillingDocumentStatusBadge status={row.original.status} />
    ),
  },
  {
    accessorKey: 'exportStatus',
    id: 'exportStatus',
    header: 'Exportação',
    filterFn: 'arrIncludesSome',
    meta: { label: 'Exportação' },
    cell: ({ row }) => <ExportStatusBadge status={row.original.exportStatus} />,
  },
  {
    accessorKey: 'dueDate',
    id: 'dueDate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vencimento" />
    ),
    meta: { label: 'Vencimento' },
    cell: ({ row }) => formatFinanceDate(row.original.dueDate),
  },
  {
    accessorKey: 'totalCents',
    id: 'totalCents',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Valor" />
    ),
    meta: { label: 'Valor' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money
          cents={row.original.totalCents}
          currency={row.original.currency}
          tone={billingDocumentToneOf(row.original.status)}
        />
      </div>
    ),
  },
]

const INSTALLMENT_BADGE_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  OPEN: 'default',
  OVERDUE: 'destructive',
  PAID: 'outline',
  VOID: 'secondary',
}

function makeInstallmentColumns(
  onReceive: (row: ReceiptRow) => void,
): ColumnDef<ReceiptRow, unknown>[] {
  return [
  {
    accessorKey: 'documentNumber',
    id: 'documentNumber',
    header: 'Documento',
    enableHiding: false,
    cell: ({ row }) =>
      row.original.documentNumber ?? `Documento #${row.original.documentId}`,
  },
  {
    accessorKey: 'customerName',
    id: 'customerName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cliente" />
    ),
    meta: { label: 'Cliente' },
  },
  {
    accessorKey: 'installmentStatus',
    id: 'installmentStatus',
    header: 'Situação',
    filterFn: 'arrIncludesSome',
    meta: { label: 'Situação' },
    cell: ({ row }) => (
      <Badge
        variant={INSTALLMENT_BADGE_VARIANT[row.original.installmentStatus] ?? 'secondary'}
      >
        {getReceivableInstallmentStatusLabel(
          parseInstallmentStatus(row.original.installmentStatus),
        )}
      </Badge>
    ),
  },
  {
    accessorKey: 'dueDate',
    id: 'dueDate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vencimento" />
    ),
    meta: { label: 'Vencimento' },
    cell: ({ row }) => formatFinanceDate(row.original.dueDate),
  },
  {
    accessorKey: 'amountCents',
    id: 'amountCents',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Valor" />
    ),
    meta: { label: 'Valor' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money
          cents={row.original.amountCents}
          tone={installmentToneOf(row.original.installmentStatus)}
        />
      </div>
    ),
  },
  {
    id: 'action',
    header: '',
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const status = row.original.installmentStatus
      if (status === 'OPEN' || status === 'OVERDUE') {
        return (
          <div className="text-right">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReceive(row.original)}
            >
              Registrar baixa
            </Button>
          </div>
        )
      }
      return (
        <div className="text-right text-sm text-muted-foreground">
          {row.original.paymentMethod
            ? PAYMENT_METHOD_LABELS[parsePaymentMethod(row.original.paymentMethod)]
            : 'Recebido'}
        </div>
      )
    },
  },
  ]
}

function parseInstallmentStatus(
  value: string,
): 'OPEN' | 'PAID' | 'OVERDUE' | 'VOID' {
  switch (value) {
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
      return value
    default:
      return 'OPEN'
  }
}

export function FinanceReceivablesPage({
  search,
}: {
  search: ReceivablesSearch
}) {
  const navigate = useNavigate()
  const tab = search.tab ?? 'documentos'

  function setTab(next: string) {
    void navigate({
      to: '/dashboard/finance/receivables',
      search: (prev) => ({
        ...prev,
        tab: next === 'recebimentos' ? 'recebimentos' : 'documentos',
      }),
    })
  }

  const documentFilters: ColumnFiltersState = []
  if (search.status) documentFilters.push({ id: 'status', value: [search.status] })
  if (search.export) {
    documentFilters.push({ id: 'exportStatus', value: [search.export] })
  }
  const installmentFilters: ColumnFiltersState = search.parcela
    ? [{ id: 'installmentStatus', value: [search.parcela] }]
    : []

  const documentsQuery = useFinanceDocumentsData({ search: '' })
  const receiptsQuery = useFinanceReceiptsData()

  const issueMutation = useIssueDocumentMutation()
  const exportMutation = useExportErpDocumentMutation()
  const receiveMutation = useReceiveInstallmentMutation()

  const [receiptRow, setReceiptRow] = useState<ReceiptRow | null>(null)
  const [paymentMethod, setPaymentMethod] =
    useState<FinancialPaymentMethod>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [receivedAt, setReceivedAt] = useState(
    new Date().toISOString().slice(0, 10),
  )

  const documents = documentsQuery.data?.data ?? []
  const installments = receiptsQuery.data?.data ?? []

  const openReceipt = useCallback((row: ReceiptRow) => {
    setReceiptRow(row)
    setPaymentMethod('BANK_TRANSFER')
    setReference('')
    setNotes('')
    setReceivedAt(new Date().toISOString().slice(0, 10))
  }, [])

  const installmentColumns = useMemo(
    () => makeInstallmentColumns(openReceipt),
    [openReceipt],
  )

  function submitReceipt() {
    if (!receiptRow) return
    receiveMutation.mutate(
      {
        installmentId: receiptRow.installmentId,
        amountCents: receiptRow.amountCents,
        paymentMethod,
        reference,
        notes,
        receivedAt: new Date(receivedAt).toISOString(),
      },
      { onSuccess: () => setReceiptRow(null) },
    )
  }

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (typeof value === 'string') void setTab(value)
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="documentos">Documentos</TabsTrigger>
              <TabsTrigger value="recebimentos">Recebimentos</TabsTrigger>
            </TabsList>
            <Button
              render={<Link to="/dashboard/finance/documents/new" />}
              type="button"
              size="sm"
              className={ACTION_BUTTON_CLASS}
            >
              <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
              Nova cobrança
            </Button>
          </div>

          <TabsContent value="documentos" className="mt-4">
            <Panel className="p-5 sm:p-6">
              <PanelHeader
                eyebrow="Cobrança"
                title="Documentos"
                description="Filtre, ordene, emita e exporte cobranças em lote."
              />
              <div className="mt-4">
                <FinanceDataTable
                  key={`docs:${search.status ?? ''}:${search.export ?? ''}`}
                  columns={documentColumns}
                  data={documents}
                  isLoading={documentsQuery.isPending}
                  getRowId={(row) => String(row.id)}
                  searchPlaceholder="Buscar por cliente ou número"
                  facets={DOCUMENT_FACETS}
                  enableRowSelection
                  initialSorting={[{ id: 'dueDate', desc: false }]}
                  initialColumnFilters={documentFilters}
                  onRowClick={(row) =>
                    navigate({
                      to: '/dashboard/finance/documents/$id',
                      params: { id: row.publicId },
                    })
                  }
                  emptyState="Nenhum documento para os filtros atuais."
                  bulkActions={(selected, clear) => {
                    const issuableIds = selected
                      .filter((doc) => doc.status === 'DRAFT')
                      .map((doc) => doc.id)
                    const exportableIds = selected
                      .filter(
                        (doc) =>
                          doc.status !== 'DRAFT' &&
                          doc.status !== 'VOID' &&
                          doc.exportStatus !== 'EXPORTED',
                      )
                      .map((doc) => doc.id)
                    const busy = issueMutation.isPending || exportMutation.isPending
                    return (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={issuableIds.length === 0 || busy}
                          onClick={() =>
                            void runBulkFinance(
                              issuableIds,
                              (id) => issueMutation.mutateAsync(id),
                              'Documentos emitidos',
                              clear,
                            )
                          }
                        >
                          Emitir ({issuableIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={exportableIds.length === 0 || busy}
                          onClick={() =>
                            void runBulkFinance(
                              exportableIds,
                              (id) => exportMutation.mutateAsync(id),
                              'Exportados para o ERP',
                              clear,
                            )
                          }
                        >
                          <HugeiconsIcon icon={SentIcon} className="mr-2 size-4" />
                          Exportar ({exportableIds.length})
                        </Button>
                      </>
                    )
                  }}
                />
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="recebimentos" className="mt-4">
            <Panel className="p-5 sm:p-6">
              <PanelHeader
                eyebrow="Recebíveis"
                title="Recebimentos"
                description="Acompanhe parcelas e registre baixas integrais."
              />
              <div className="mt-4">
                <FinanceDataTable
                  key={`inst:${search.parcela ?? ''}`}
                  columns={installmentColumns}
                  data={installments}
                  isLoading={receiptsQuery.isPending}
                  getRowId={(row) => String(row.installmentId)}
                  searchPlaceholder="Buscar por cliente ou documento"
                  facets={INSTALLMENT_FACETS}
                  initialSorting={[{ id: 'dueDate', desc: false }]}
                  initialColumnFilters={installmentFilters}
                  emptyState="Nenhuma parcela para os filtros atuais."
                />
              </div>
            </Panel>
          </TabsContent>
        </Tabs>
      </StaggerItem>

      <Dialog
        open={receiptRow !== null}
        onOpenChange={(open) => {
          if (!open) setReceiptRow(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar baixa</DialogTitle>
            <DialogDescription>
              Baixa integral da parcela em aberto.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>Valor</FieldLabel>
              <div className="rounded-md border px-3 py-2">
                <Money cents={receiptRow?.amountCents ?? 0} />
              </div>
            </Field>
            <Field>
              <FieldLabel>Método de pagamento</FieldLabel>
              <NativeSelect
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(parsePaymentMethod(event.target.value))
                }
              >
                {PAYMENT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>Data do recebimento</FieldLabel>
              <Input
                type="date"
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Referência</FieldLabel>
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="NSU, número da transferência, etc."
              />
            </Field>
            <Field>
              <FieldLabel>Observações</FieldLabel>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReceiptRow(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submitReceipt}
              disabled={receiveMutation.isPending}
            >
              {receiveMutation.isPending ? 'Registrando…' : 'Confirmar baixa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  )
}
