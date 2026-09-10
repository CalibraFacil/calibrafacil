import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Building03Icon,
  Clock01Icon,
  ToolsIcon,
} from '@hugeicons/core-free-icons'

import { useCustomerGroupDetailData } from '@/features/customer-groups/queries'
import {
  ClientMetric,
  ClientMetricStrip,
  ClientPanel,
  ClientPanelBody,
  ClientSection,
  TableFrame,
} from '@/features/customers/components/client-detail-ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { clientRouteId } from '@/lib/route-identifiers'

export function CustomerGroupOverviewTab({ groupId }: { groupId: number }) {
  const { data: group, isLoading } = useCustomerGroupDetailData(groupId)

  if (isLoading) {
    return <OverviewSkeleton />
  }

  if (!group) {
    return (
      <div className="rounded-2xl bg-card px-6 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        Grupo não encontrado
      </div>
    )
  }

  const branches = group.branches
  const totals = branches.reduce(
    (acc, branch) => ({
      total: acc.total + branch.total,
      overdue: acc.overdue + branch.overdue,
      dueSoon: acc.dueSoon + branch.dueSoon,
    }),
    { total: 0, overdue: 0, dueSoon: 0 },
  )

  // Worst-first: the units that most need attention surface at the top.
  // (Copy first — sort mutates; the lint warning about sort() is moot here.)
  const rankedBranches = [...branches].sort(
    (a, b) =>
      b.overdue - a.overdue || b.dueSoon - a.dueSoon || b.total - a.total,
  )

  return (
    <ClientPanel
      title="Programa metrológico do grupo"
      description="Situação consolidada dos instrumentos de todas as unidades, com as unidades que mais precisam de atenção no topo."
    >
      <ClientMetricStrip className="xl:grid-cols-4">
        <ClientMetric
          icon={<HugeiconsIcon icon={Building03Icon} className="size-4" />}
          label="Unidades"
          value={String(branches.length)}
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={ToolsIcon} className="size-4" />}
          label="Instrumentos Ativos"
          value={String(totals.total)}
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={Alert02Icon} className="size-4" />}
          label="Vencidos"
          tone={totals.overdue > 0 ? 'danger' : 'default'}
          value={String(totals.overdue)}
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={Clock01Icon} className="size-4" />}
          label="A Vencer (30d)"
          value={String(totals.dueSoon)}
        />
      </ClientMetricStrip>

      <ClientPanelBody>
        <ClientSection
          icon={<HugeiconsIcon icon={Building03Icon} className="size-4" />}
          title="Por unidade"
          description="Instrumentos ativos, vencidos e a vencer em cada unidade do grupo."
        >
          {branches.length === 0 ? (
            <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Building03Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma unidade</EmptyTitle>
                <EmptyDescription>
                  Vincule clientes a este grupo na aba Unidades para acompanhar
                  o programa metrológico consolidado.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead className="text-right">Ativos</TableHead>
                    <TableHead className="text-right">Vencidos</TableHead>
                    <TableHead className="text-right">A vencer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankedBranches.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell>
                        <Link
                          to="/dashboard/clients/$id/overview"
                          params={{
                            id: clientRouteId({
                              name: branch.name,
                              taxId: branch.taxId,
                            }),
                          }}
                          className="font-medium hover:underline"
                        >
                          {branch.name}
                        </Link>
                        {branch.taxId ? (
                          <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                            {branch.taxId}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {branch.total}
                      </TableCell>
                      <TableCell className="text-right">
                        {branch.overdue > 0 ? (
                          <Badge variant="destructive" className="tabular-nums">
                            {branch.overdue}
                          </Badge>
                        ) : (
                          <span className="font-mono tabular-nums text-muted-foreground">
                            0
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {branch.dueSoon}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          )}
        </ClientSection>
      </ClientPanelBody>
    </ClientPanel>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
