import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { useFinanceAccess } from '@/hooks/use-finance-access'
import {
  BillingDocumentStatusBadge,
  ExportStatusBadge,
} from '@/components/finance-status-badges'
import { formatFinanceDate, formatFinanceMoney } from '@/lib/finance-formatters'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { calibraApi } from '@/utils/api'

type BillingDocumentDetails = {
  id: number
  documentNumber: string | null
  status: string
  customerName: string
  unitName: string
  dueDate: string
  issueDate: string | null
  currency: string
  subtotalCents: number
  discountCents: number
  totalCents: number
  notes: string | null
  exportStatus: string
  exportedAt: string | null
  voidReason: string | null
  items: Array<{
    id: number
    jobId: number | null
    jobDisplayId: string | null
    description: string
    quantity: number
    unitPriceCents: number
    totalCents: number
  }>
  installments: Array<{
    id: number
    installmentNumber: number
    status: string
    dueDate: string
    amountCents: number
    currency: string
    paidAt: string | null
    paymentMethod: string | null
    paymentReference: string | null
  }>
  receipts: Array<{
    id: number
    amountCents: number
    paymentMethod: string
    reference: string | null
    receivedAt: string
  }>
  audit: Array<{
    id: number
    action: string
    reason: string | null
    performedAt: string
  }>
}

export const Route = createFileRoute('/dashboard/finance/documents/$id')({
  head: () => ({
    meta: [{ title: 'Documento financeiro | CalibraFácil' }],
  }),
  component: FinanceDocumentDetailsPage,
})

function FinanceDocumentDetailsPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const financeAccess = useFinanceAccess()
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')

  const documentQuery = useQuery({
    queryKey: ['finance', 'documents', id],
    queryFn: async () => {
      return calibraApi.finance.getDocument<{ data: BillingDocumentDetails }>(
        id,
      )
    },
  })

  const document = documentQuery.data?.data

  const updateMutation = useMutation({
    mutationFn: async (draft: {
      dueDate: string
      discountCents: string
      notes: string
    }) => {
      return calibraApi.finance.updateDocument(id, {
        dueDate: draft.dueDate
          ? new Date(draft.dueDate).toISOString()
          : undefined,
        notes: draft.notes,
        discountCents: Number(draft.discountCents) || 0,
      })
    },
    onSuccess: () => {
      toast.success('Documento atualizado')
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents', id] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const issueMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.finance.issueDocument(id)
    },
    onSuccess: () => {
      toast.success('Documento emitido')
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents', id] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'receipts'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const voidMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.finance.voidDocument(id, { reason: voidReason })
    },
    onSuccess: () => {
      toast.success('Documento anulado')
      setVoidDialogOpen(false)
      setVoidReason('')
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents', id] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'receipts'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const exportMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.finance.exportErpDocument(id)
    },
    onSuccess: () => {
      toast.success('Documento exportado para o ERP')
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents', id] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'erp'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
    },
    onError: (error) => toast.error(error.message),
  })

  if (!document) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Documento financeiro</CardTitle>
          <CardDescription>
            {documentQuery.isPending
              ? 'Carregando documento...'
              : 'Documento não encontrado.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const canExport =
    financeAccess.data?.canExportFinancial &&
    ['ISSUED', 'PAID', 'OVERDUE'].includes(document.status)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <CardTitle>
                {document.documentNumber ?? `Rascunho #${document.id}`}
              </CardTitle>
              <BillingDocumentStatusBadge status={document.status} />
              <ExportStatusBadge status={document.exportStatus} />
            </div>
            <CardDescription>
              {document.customerName} · {document.unitName}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {document.status === 'DRAFT' && (
              <>
                <Button
                  onClick={() => issueMutation.mutate()}
                  disabled={issueMutation.isPending}
                >
                  {issueMutation.isPending ? 'Emitindo...' : 'Emitir documento'}
                </Button>
              </>
            )}
            {document.status !== 'VOID' && (
              <Button variant="outline" onClick={() => setVoidDialogOpen(true)}>
                Anular documento
              </Button>
            )}
            {canExport && (
              <Button
                variant="outline"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? 'Exportando...' : 'Exportar ERP'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InfoItem
            label="Emissão"
            value={formatFinanceDate(document.issueDate)}
          />
          <InfoItem
            label="Vencimento"
            value={formatFinanceDate(document.dueDate)}
          />
          <InfoItem
            label="Subtotal"
            value={formatFinanceMoney(
              document.subtotalCents,
              document.currency,
            )}
          />
          <InfoItem
            label="Total"
            value={formatFinanceMoney(document.totalCents, document.currency)}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Itens do documento</CardTitle>
            <CardDescription>
              Cada item foi materializado a partir do snapshot comercial da OS.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>Qtd.</TableHead>
                  <TableHead className="text-right">Unitário</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {document.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{item.jobDisplayId ?? 'Manual'}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatFinanceMoney(
                        item.unitPriceCents,
                        document.currency,
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatFinanceMoney(item.totalCents, document.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parâmetros do documento</CardTitle>
            <CardDescription>
              Rascunhos permitem ajustar vencimento, desconto e observações.
            </CardDescription>
          </CardHeader>
          <DocumentParametersCard
            key={`${document.id}:${document.dueDate}:${document.discountCents}:${document.notes ?? ''}`}
            document={document}
            isSaving={updateMutation.isPending}
            onSave={(draft) => updateMutation.mutate(draft)}
          />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Parcela e recebimentos</CardTitle>
            <CardDescription>
              O MVP trabalha com parcela única e baixa integral manual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {document.installments.map((installment) => (
                  <TableRow key={installment.id}>
                    <TableCell>{installment.installmentNumber}</TableCell>
                    <TableCell>{installment.status}</TableCell>
                    <TableCell>
                      {formatFinanceDate(installment.dueDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatFinanceMoney(
                        installment.amountCents,
                        installment.currency,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {document.receipts.length > 0 ? (
                  document.receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell>
                        {formatFinanceDate(receipt.receivedAt)}
                      </TableCell>
                      <TableCell>{receipt.paymentMethod}</TableCell>
                      <TableCell>
                        {receipt.reference || 'Sem referência'}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatFinanceMoney(
                          receipt.amountCents,
                          document.currency,
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-muted-foreground text-center"
                    >
                      Nenhuma baixa registrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Auditoria</CardTitle>
            <CardDescription>
              Trilha das ações aplicadas ao documento financeiro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ação</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {document.audit.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.action}</TableCell>
                    <TableCell>
                      {formatFinanceDate(entry.performedAt)}
                    </TableCell>
                    <TableCell>{entry.reason || 'Sem motivo'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

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
              placeholder="Descreva o motivo..."
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
              onClick={() => voidMutation.mutate()}
              disabled={voidMutation.isPending}
            >
              {voidMutation.isPending ? 'Anulando...' : 'Confirmar anulação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
    discountCents: string
    notes: string
  }) => void
}) {
  const [dueDate, setDueDate] = useState(document.dueDate.slice(0, 10))
  const [discountCents, setDiscountCents] = useState(
    String(document.discountCents),
  )
  const [notes, setNotes] = useState(document.notes ?? '')

  return (
    <CardContent className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel>Vencimento</FieldLabel>
          <Input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={document.status !== 'DRAFT'}
          />
        </Field>
        <Field>
          <FieldLabel>Desconto (centavos)</FieldLabel>
          <Input
            type="number"
            min={0}
            value={discountCents}
            onChange={(event) => setDiscountCents(event.target.value)}
            disabled={document.status !== 'DRAFT'}
          />
        </Field>
        <Field>
          <FieldLabel>Observações</FieldLabel>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={document.status !== 'DRAFT'}
          />
        </Field>
      </FieldGroup>
      {document.status === 'DRAFT' ? (
        <Button
          onClick={() => onSave({ dueDate, discountCents, notes })}
          disabled={isSaving}
        >
          {isSaving ? 'Salvando...' : 'Salvar rascunho'}
        </Button>
      ) : null}
    </CardContent>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 font-medium">{value}</div>
    </div>
  )
}
