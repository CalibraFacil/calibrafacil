import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircleIcon,
  Calendar03Icon,
  CreditCardIcon,
  Invoice02Icon,
} from '@hugeicons/core-free-icons'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { calibraApi } from '@/utils/api'

type FinanceOverviewResponse = {
  totals: {
    issuedCents: number
    openCents: number
    overdueCents: number
    receivedCents: number
  }
  counts: {
    draftDocuments: number
    issuedDocuments: number
    overdueDocuments: number
    paidDocuments: number
  }
  aging: Record<string, number>
  recentDocuments: Array<{
    id: number
    documentNumber: string | null
    status: string
    exportStatus: string
    totalCents: number
    dueDate: string
    issueDate: string | null
    customerName: string
    unitName: string
  }>
  pendingExports: number
}

export const Route = createFileRoute('/dashboard/finance/')({
  head: () => ({
    meta: [{ title: 'Visão geral financeira | CalibraFácil' }],
  }),
  component: FinanceOverviewPage,
})

function FinanceOverviewPage() {
  const overviewQuery = useQuery({
    queryKey: ['finance', 'overview'],
    queryFn: async () => {
      return calibraApi.finance.getOverview<FinanceOverviewResponse>()
    },
  })

  if (overviewQuery.isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={AlertCircleIcon} />
          </EmptyMedia>
          <EmptyTitle>Falha ao carregar a visão geral</EmptyTitle>
          <EmptyDescription>
            Tente novamente para consultar o painel financeiro.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const data = overviewQuery.data

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Emitido"
          description="Documentos emitidos no ciclo atual"
          value={formatFinanceMoney(data?.totals.issuedCents ?? 0)}
        />
        <SummaryCard
          title="Em aberto"
          description="Saldo operacional pendente"
          value={formatFinanceMoney(data?.totals.openCents ?? 0)}
        />
        <SummaryCard
          title="Vencido"
          description="Recebíveis com atraso"
          value={formatFinanceMoney(data?.totals.overdueCents ?? 0)}
        />
        <SummaryCard
          title="Recebido"
          description="Baixas registradas"
          value={formatFinanceMoney(data?.totals.receivedCents ?? 0)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Documentos recentes</CardTitle>
              <CardDescription>
                Últimas cobranças emitidas ou em preparação.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              render={<Link to="/dashboard/finance/documents" />}
            >
              <HugeiconsIcon icon={Invoice02Icon} className="mr-2 size-4" />
              Ver documentos
            </Button>
          </CardHeader>
          <CardContent>
            {overviewQuery.isPending ? (
              <div className="text-muted-foreground py-8 text-sm">
                Carregando documentos recentes...
              </div>
            ) : data?.recentDocuments.length ? (
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
                  {data.recentDocuments.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        <Link
                          to="/dashboard/finance/documents/$id"
                          params={{ id: String(document.id) }}
                          className="font-medium hover:underline"
                        >
                          {document.documentNumber ??
                            `Rascunho #${document.id}`}
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
                      <TableCell>
                        {formatFinanceDate(document.dueDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatFinanceMoney(document.totalCents)}
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
                  <EmptyTitle>Nenhum documento ainda</EmptyTitle>
                  <EmptyDescription>
                    Assim que as primeiras cobranças forem criadas, elas
                    aparecerão aqui.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Envelhecimento</CardTitle>
              <CardDescription>
                Distribuição do saldo vencido por faixa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AgingRow label="0 a 30 dias" value={data?.aging['0_30'] ?? 0} />
              <AgingRow
                label="31 a 60 dias"
                value={data?.aging['31_60'] ?? 0}
              />
              <AgingRow
                label="61 a 90 dias"
                value={data?.aging['61_90'] ?? 0}
              />
              <AgingRow
                label="Acima de 90 dias"
                value={data?.aging['90_plus'] ?? 0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Indicadores operacionais</CardTitle>
              <CardDescription>
                Situação do pipeline financeiro do laboratório.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <IndicatorRow
                icon={CreditCardIcon}
                label="Rascunhos"
                value={String(data?.counts.draftDocuments ?? 0)}
              />
              <IndicatorRow
                icon={Calendar03Icon}
                label="Emitidos"
                value={String(data?.counts.issuedDocuments ?? 0)}
              />
              <IndicatorRow
                icon={AlertCircleIcon}
                label="Vencidos"
                value={String(data?.counts.overdueDocuments ?? 0)}
              />
              <IndicatorRow
                icon={Invoice02Icon}
                label="Pendentes de exportação"
                value={String(data?.pendingExports ?? 0)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: string
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {description}
      </CardContent>
    </Card>
  )
}

function AgingRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-muted-foreground">
        {formatFinanceMoney(value)}
      </span>
    </div>
  )
}

function IndicatorRow({
  icon,
  label,
  value,
}: {
  icon: typeof CreditCardIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={icon} className="text-muted-foreground size-4" />
        <span className="text-sm">{label}</span>
      </div>
      <span className="font-medium">{value}</span>
    </div>
  )
}
