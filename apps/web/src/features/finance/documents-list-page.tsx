import { Link } from '@tanstack/react-router'
import { parseAsString, useQueryState } from 'nuqs'
import { Invoice02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useFinanceDocumentsData } from '@/features/finance/queries'

export function FinanceDocumentsPage() {
  const [query, setQuery] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const documentsQuery = useFinanceDocumentsData({ search: query })

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
          <Button
            render={<Link to="/dashboard/finance/documents/new" />}
            type="button"
          >
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
                      {formatFinanceMoney(
                        document.totalCents,
                        document.currency,
                      )}
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
    </div>
  )
}
