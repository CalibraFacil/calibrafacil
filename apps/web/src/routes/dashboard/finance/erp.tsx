import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/utils/api'

type ErpExportsResponse = {
  billing: {
    planId: string
    planName: string
    hasCustomIntegrations: boolean
  }
  data: Array<{
    id: number
    documentNumber: string | null
    customerName: string
    status: string
    exportStatus: string
    exportedAt: string | null
    totalCents: number
    currency: string
    dueDate: string
    issueDate: string | null
  }>
}

export const Route = createFileRoute('/dashboard/finance/erp')({
  head: () => ({
    meta: [{ title: 'ERP financeiro | CalibraFácil' }],
  }),
  component: FinanceErpPage,
})

function FinanceErpPage() {
  const queryClient = useQueryClient()

  const exportsQuery = useQuery({
    queryKey: ['finance', 'erp'],
    queryFn: async () => {
      const response = await api.api.finance.erp.exports.$get()
      if (!response.ok) {
        throw new Error('Erro ao carregar fila ERP')
      }

      return response.json() as Promise<ErpExportsResponse>
    },
  })

  const exportMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await api.api.finance.erp.documents[':id'].export.$post({
        param: { id: String(documentId) },
      })
      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || 'Erro ao exportar documento')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('Exportação ERP concluída')
      queryClient.invalidateQueries({ queryKey: ['finance', 'erp'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] })
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Fila ERP</CardTitle>
          <CardDescription>
            O plano atual é {exportsQuery.data?.billing.planName ?? '...'}.
            Documentos emitidos podem ser reenviados para a integração
            financeira.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Exportação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(exportsQuery.data?.data ?? []).map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    {document.documentNumber ?? `Documento #${document.id}`}
                    <div className="text-muted-foreground text-xs">
                      emissão {formatFinanceDate(document.issueDate)}
                    </div>
                  </TableCell>
                  <TableCell>{document.customerName}</TableCell>
                  <TableCell>
                    <BillingDocumentStatusBadge status={document.status} />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <ExportStatusBadge status={document.exportStatus} />
                      <div className="text-muted-foreground text-xs">
                        {document.exportedAt
                          ? `último envio em ${formatFinanceDate(document.exportedAt)}`
                          : 'sem envio concluído'}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatFinanceMoney(document.totalCents, document.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportMutation.mutate(document.id)}
                      disabled={
                        exportMutation.isPending ||
                        !exportsQuery.data?.billing.hasCustomIntegrations
                      }
                    >
                      Reenviar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
