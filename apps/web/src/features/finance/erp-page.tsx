import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { calibraApi } from '@/utils/api'
import { useFinanceErpData } from '@/features/finance/queries'

export function FinanceErpPage() {
  const queryClient = useQueryClient()

  const exportsQuery = useFinanceErpData()

  const exportMutation = useMutation({
    mutationFn: async (documentId: number) => {
      return calibraApi.finance.exportErpDocument(documentId)
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
