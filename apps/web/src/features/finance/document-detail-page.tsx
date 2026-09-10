import { useState } from 'react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'

import { getReceivableInstallmentStatusLabel } from '@calibra-facil/shared'

import { useFinanceAccess } from '@/hooks/use-finance-access'
import {
  BillingDocumentStatusBadge,
  ExportStatusBadge,
} from '@/components/finance-status-badges'
import { formatFinanceDate, formatFinanceMoney } from '@/lib/finance-formatters'
import {
  Money,
  billingDocumentToneOf,
  installmentToneOf,
} from '@/features/finance/finance-display'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
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
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import { FinanceDataTable } from '@/features/finance/components/finance-data-table'
import { Textarea } from '@/components/ui/textarea'
import { useFinanceDocumentDetailData } from '@/features/finance/queries'
import {
  useExportErpDocumentMutation,
  useIssueDocumentMutation,
  useUpdateDocumentMutation,
  useVoidDocumentMutation,
} from '@/features/finance/mutations'
import { DocumentTimeline } from '@/features/finance/document-timeline'
import type { BillingDocumentDetails } from '@/features/finance/types'

function installmentStatusLabel(value: string): string {
  switch (value) {
    case 'OPEN':
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
      return getReceivableInstallmentStatusLabel(value)
    default:
      return value
  }
}

type DocumentItem = BillingDocumentDetails['items'][number]
type DocumentInstallment = BillingDocumentDetails['installments'][number]

function makeItemColumns(currency: string): ColumnDef<DocumentItem, unknown>[] {
  return [
    {
      accessorKey: 'description',
      id: 'description',
      header: 'Descrição',
      enableHiding: false,
      cell: ({ row }) => row.original.description,
    },
    {
      accessorKey: 'jobDisplayId',
      id: 'jobDisplayId',
      header: 'OS',
      meta: { label: 'OS' },
      cell: ({ row }) => row.original.jobDisplayId ?? 'Manual',
    },
    {
      accessorKey: 'quantity',
      id: 'quantity',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Qtd." />
      ),
      meta: { label: 'Qtd.' },
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{row.original.quantity}</span>
      ),
    },
    {
      accessorKey: 'unitPriceCents',
      id: 'unitPriceCents',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Unitário" />
      ),
      meta: { label: 'Unitário' },
      cell: ({ row }) => (
        <div className="text-right">
          <Money cents={row.original.unitPriceCents} currency={currency} />
        </div>
      ),
    },
    {
      accessorKey: 'totalCents',
      id: 'totalCents',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" />
      ),
      meta: { label: 'Total' },
      cell: ({ row }) => (
        <div className="text-right">
          <Money cents={row.original.totalCents} currency={currency} />
        </div>
      ),
    },
  ]
}

const installmentColumns: ColumnDef<DocumentInstallment, unknown>[] = [
  {
    accessorKey: 'installmentNumber',
    id: 'installmentNumber',
    header: 'Parcela',
    enableHiding: false,
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.installmentNumber}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    id: 'status',
    header: 'Status',
    cell: ({ row }) => installmentStatusLabel(row.original.status),
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
          currency={row.original.currency}
          tone={installmentToneOf(row.original.status)}
        />
      </div>
    ),
  },
]

export function FinanceDocumentDetailsPage({ id }: { id: string }) {
  const financeAccess = useFinanceAccess()
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')

  const documentQuery = useFinanceDocumentDetailData<{
    data: BillingDocumentDetails
  }>(id)
  const document = documentQuery.data?.data

  const issueMutation = useIssueDocumentMutation()
  const exportMutation = useExportErpDocumentMutation()
  const updateMutation = useUpdateDocumentMutation()
  const voidMutation = useVoidDocumentMutation()

  if (!document) {
    return (
      <Panel className="p-6">
        <PanelHeader
          title={
            documentQuery.isPending
              ? 'Carregando documento…'
              : 'Documento não encontrado'
          }
        />
      </Panel>
    )
  }

  const canExport =
    financeAccess.data?.canExportFinancial &&
    ['ISSUED', 'PAID', 'OVERDUE'].includes(document.status)
  const isDraft = document.status === 'DRAFT'
  const itemColumns = makeItemColumns(document.currency)

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <Panel className="relative overflow-hidden p-5 sm:p-6">
          <BlueprintOverlay />
          <div className="relative flex flex-col gap-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
                    {document.documentNumber ?? `Rascunho #${document.id}`}
                  </h1>
                  <BillingDocumentStatusBadge status={document.status} />
                  <ExportStatusBadge status={document.exportStatus} />
                </div>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {document.customerName} · {document.unitName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isDraft ? (
                  <Button
                    className={ACTION_BUTTON_CLASS}
                    onClick={() =>
                      issueMutation.mutate(document.id, {
                        onSuccess: () => toast.success('Documento emitido'),
                      })
                    }
                    disabled={issueMutation.isPending}
                  >
                    {issueMutation.isPending ? 'Emitindo…' : 'Emitir documento'}
                  </Button>
                ) : null}
                {document.status !== 'VOID' ? (
                  <Button
                    variant="outline"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => setVoidDialogOpen(true)}
                  >
                    Anular documento
                  </Button>
                ) : null}
                {canExport ? (
                  <Button
                    variant="outline"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() =>
                      exportMutation.mutate(document.id, {
                        onSuccess: () =>
                          toast.success('Documento exportado para o ERP'),
                      })
                    }
                    disabled={exportMutation.isPending}
                  >
                    {exportMutation.isPending ? 'Exportando…' : 'Exportar ERP'}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SignalTile
                label="Total"
                value={formatFinanceMoney(
                  document.totalCents,
                  document.currency,
                )}
                tone={billingDocumentToneOf(document.status)}
              />
              <SignalTile
                label="Subtotal"
                value={formatFinanceMoney(
                  document.subtotalCents,
                  document.currency,
                )}
                tone="neutral"
              />
              <SignalTile
                label="Desconto"
                value={formatFinanceMoney(
                  document.discountCents,
                  document.currency,
                )}
                tone={document.discountCents > 0 ? 'info' : 'neutral'}
              />
              <SignalTile
                label="Vencimento"
                value={formatFinanceDate(document.dueDate)}
                hint={`emissão ${formatFinanceDate(document.issueDate)}`}
                tone={document.status === 'OVERDUE' ? 'critical' : 'neutral'}
              />
            </div>
          </div>
        </Panel>
      </StaggerItem>

      <StaggerItem>
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Itens do documento"
              description="Materializados a partir do snapshot comercial da OS."
            />
            <div className="mt-4">
              <FinanceDataTable
                columns={itemColumns}
                data={document.items}
                getRowId={(item) => String(item.id)}
                searchPlaceholder="Buscar item"
                emptyState="Sem itens."
              />
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Ajustes do rascunho"
              description="Rascunhos permitem ajustar vencimento, desconto e observações."
            />
            <DocumentParametersCard
              key={`${document.id}:${document.dueDate}:${document.discountCents}:${document.notes ?? ''}`}
              document={document}
              isSaving={updateMutation.isPending}
              onSave={(draft) =>
                updateMutation.mutate(
                  {
                    id: document.id,
                    dueDate: draft.dueDate
                      ? new Date(draft.dueDate).toISOString()
                      : undefined,
                    notes: draft.notes,
                    discountCents: draft.discountCents,
                  },
                  { onSuccess: () => toast.success('Documento atualizado') },
                )
              }
            />
          </Panel>
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Parcelas"
              description="Parcela única com baixa integral manual no MVP."
            />
            <div className="mt-4">
              <FinanceDataTable
                columns={installmentColumns}
                data={document.installments}
                getRowId={(installment) => String(installment.id)}
                enableSearch={false}
                emptyState="Sem parcelas."
              />
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Linha do tempo"
              description="Auditoria e baixas em ordem cronológica."
            />
            <div className="mt-4">
              <DocumentTimeline
                audit={document.audit}
                receipts={document.receipts}
                currency={document.currency}
              />
            </div>
          </Panel>
        </div>
      </StaggerItem>

      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular documento</DialogTitle>
            <DialogDescription>
              A anulação libera as OS para um novo faturamento e registra o
              motivo na auditoria.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Motivo da anulação</FieldLabel>
            <Textarea
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Descreva o motivo…"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setVoidDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                voidMutation.isPending || voidReason.trim().length === 0
              }
              onClick={() =>
                voidMutation.mutate(
                  { id: document.id, reason: voidReason },
                  {
                    onSuccess: () => {
                      toast.success('Documento anulado')
                      setVoidDialogOpen(false)
                      setVoidReason('')
                    },
                  },
                )
              }
            >
              {voidMutation.isPending ? 'Anulando…' : 'Confirmar anulação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  )
}

function DocumentParametersCard({
  document,
  isSaving,
  onSave,
}: {
  document: BillingDocumentDetails
  isSaving: boolean
  onSave: (draft: {
    dueDate: string
    discountCents: number
    notes: string
  }) => void
}) {
  const [dueDate, setDueDate] = useState(document.dueDate.slice(0, 10))
  const [discountCents, setDiscountCents] = useState(document.discountCents)
  const [notes, setNotes] = useState(document.notes ?? '')
  const isDraft = document.status === 'DRAFT'

  return (
    <div className="mt-4 space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel>Vencimento</FieldLabel>
          <Input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={!isDraft}
          />
        </Field>
        <Field>
          <FieldLabel>Desconto</FieldLabel>
          <CurrencyInput
            valueCents={discountCents}
            onValueChange={setDiscountCents}
            currency={document.currency}
            disabled={!isDraft}
          />
        </Field>
        <Field>
          <FieldLabel>Observações</FieldLabel>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={!isDraft}
          />
        </Field>
      </FieldGroup>
      {isDraft ? (
        <Button
          className={ACTION_BUTTON_CLASS}
          onClick={() => onSave({ dueDate, discountCents, notes })}
          disabled={isSaving}
        >
          {isSaving ? 'Salvando…' : 'Salvar rascunho'}
        </Button>
      ) : null}
    </div>
  )
}
