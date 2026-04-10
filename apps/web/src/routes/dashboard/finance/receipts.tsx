import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { BillingDocumentStatusBadge } from '@/components/finance-status-badges'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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

type ReceiptRow = {
  installmentId: number
  documentId: number
  documentNumber: string | null
  documentStatus: string
  customerName: string
  dueDate: string
  amountCents: number
  installmentStatus: string
  paidAt: string | null
  paymentMethod: string | null
  paymentReference: string | null
}

const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'PIX',
  'BOLETO',
  'CREDIT_CARD',
  'CASH',
  'OTHER',
] as const

export const Route = createFileRoute('/dashboard/finance/receipts')({
  head: () => ({
    meta: [{ title: 'Recebimentos | CalibraFácil' }],
  }),
  component: FinanceReceiptsPage,
})

function FinanceReceiptsPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<ReceiptRow | null>(null)
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [receivedAt, setReceivedAt] = useState(
    new Date().toISOString().slice(0, 10),
  )

  const receiptsQuery = useQuery({
    queryKey: ['finance', 'receipts'],
    queryFn: async () => {
      const response = await api.api.finance.receipts.$get()
      if (!response.ok) {
        throw new Error('Erro ao carregar recebimentos')
      }

      return response.json() as Promise<{ data: ReceiptRow[] }>
    },
  })

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow) {
        throw new Error('Selecione uma parcela para baixa')
      }

      const response = await api.api.finance.installments[':id'].receive.$post({
        param: { id: String(selectedRow.installmentId) },
        json: {
          amountCents: selectedRow.amountCents,
          paymentMethod,
          reference: reference || undefined,
          notes: notes || undefined,
          receivedAt: new Date(receivedAt).toISOString(),
        },
      })

      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || 'Erro ao registrar recebimento')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('Baixa registrada')
      setDialogOpen(false)
      setSelectedRow(null)
      setReference('')
      setNotes('')
      queryClient.invalidateQueries({ queryKey: ['finance', 'receipts'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Recebimentos</CardTitle>
          <CardDescription>
            Registre baixas integrais e acompanhe parcelas abertas, vencidas ou
            já recebidas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(receiptsQuery.data?.data ?? []).map((row) => (
                <TableRow key={row.installmentId}>
                  <TableCell>
                    {row.documentNumber ?? `Documento #${row.documentId}`}
                    <div className="text-muted-foreground text-xs">
                      Parcela #{row.installmentId}
                    </div>
                  </TableCell>
                  <TableCell>{row.customerName}</TableCell>
                  <TableCell>
                    <BillingDocumentStatusBadge status={row.documentStatus} />
                  </TableCell>
                  <TableCell>{formatFinanceDate(row.dueDate)}</TableCell>
                  <TableCell className="text-right">
                    {formatFinanceMoney(row.amountCents)}
                  </TableCell>
                  <TableCell className="text-right">
                    {['OPEN', 'OVERDUE'].includes(row.installmentStatus) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedRow(row)
                          setDialogOpen(true)
                        }}
                      >
                        Registrar baixa
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {row.paymentMethod || 'Recebido'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar baixa</DialogTitle>
            <DialogDescription>
              O MVP aceita somente baixa integral da parcela em aberto.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel>Valor</FieldLabel>
              <Input
                value={
                  selectedRow
                    ? formatFinanceMoney(selectedRow.amountCents)
                    : 'R$ 0,00'
                }
                disabled
              />
            </Field>

            <Field>
              <FieldLabel>Método de pagamento</FieldLabel>
              <NativeSelect
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(
                    event.target.value as (typeof PAYMENT_METHODS)[number],
                  )
                }
              >
                {PAYMENT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {method}
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
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => receiveMutation.mutate()}
              disabled={receiveMutation.isPending}
            >
              {receiveMutation.isPending ? 'Registrando...' : 'Confirmar baixa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
