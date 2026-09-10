import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import {
  type BillingReadinessItem,
  type BillingReadinessStatus,
  type BillingReadinessSummary,
  getBillingBlockerOwnerLabel,
  getBillingReadinessStatusLabel,
} from '@calibra-facil/shared'

import { formatFinanceDate } from '@/lib/finance-formatters'
import { Money, billingReadinessTone } from '@/features/finance/finance-display'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import {
  FinanceDataTable,
  type FacetConfig,
} from '@/features/finance/components/finance-data-table'
import { calibraApi } from '@/utils/api'
import { useFinanceBillingReadinessData } from '@/features/finance/queries'

const STATUS_VARIANT: Record<
  BillingReadinessStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  READY: 'default',
  BLOCKED: 'destructive',
  BILLED: 'secondary',
  SENT: 'outline',
}

function ReadinessStatusBadge({ status }: { status: BillingReadinessStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {getBillingReadinessStatusLabel(status)}
    </Badge>
  )
}

const READINESS_STATUSES: BillingReadinessStatus[] = [
  'READY',
  'BLOCKED',
  'BILLED',
  'SENT',
]

const READINESS_FACETS: FacetConfig[] = [
  {
    columnId: 'status',
    title: 'Situação',
    options: READINESS_STATUSES.map((value) => ({
      value,
      label: getBillingReadinessStatusLabel(value),
    })),
  },
]

const SUMMARY_TILES: Array<{
  key: keyof BillingReadinessSummary
  status: BillingReadinessStatus
  label: string
  tone: SignalTone
}> = [
  {
    key: 'ready',
    status: 'READY',
    label: 'Prontas para faturar',
    tone: 'info',
  },
  { key: 'blocked', status: 'BLOCKED', label: 'Bloqueadas', tone: 'critical' },
  { key: 'billed', status: 'BILLED', label: 'Faturadas', tone: 'neutral' },
  { key: 'sent', status: 'SENT', label: 'Enviadas', tone: 'ok' },
]

function makeReadinessColumns({
  onSend,
  sending,
}: {
  onSend: (id: number) => void
  sending: boolean
}): ColumnDef<BillingReadinessItem, unknown>[] {
  return [
    {
      id: 'customer',
      accessorFn: (row) => `${row.customer.name} ${row.serviceOrderNumber}`,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Cliente / OS" />
      ),
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.customer.name}</div>
          <div className="text-xs text-muted-foreground">
            OS {row.original.serviceOrderNumber} · {row.original.unit.name}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      accessorFn: (row) => row.readinessStatus,
      header: 'Situação',
      filterFn: 'arrIncludesSome',
      meta: { label: 'Situação' },
      cell: ({ row }) => (
        <div className="space-y-1.5">
          <ReadinessStatusBadge status={row.original.readinessStatus} />
          {row.original.blockers.map((blocker) => (
            <div
              key={blocker.code}
              className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs leading-tight shadow-[inset_0_0_0_1px_rgba(239,68,68,0.18)]"
            >
              <span className="font-medium text-destructive">
                {blocker.label}
              </span>
              <div className="mt-0.5 text-muted-foreground">
                {getBillingBlockerOwnerLabel(blocker.owner)} —{' '}
                {blocker.fixAction}
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'completedAt',
      accessorFn: (row) => row.completedAt ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Concluída" />
      ),
      meta: { label: 'Concluída' },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatFinanceDate(row.original.completedAt)}
        </span>
      ),
    },
    {
      id: 'amount',
      accessorFn: (row) => row.amountCents,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Valor" />
      ),
      meta: { label: 'Valor' },
      cell: ({ row }) => (
        <div className="text-right">
          <Money
            cents={row.original.amountCents}
            currency={row.original.currency}
            tone={billingReadinessTone(row.original.readinessStatus)}
          />
        </div>
      ),
    },
    {
      id: 'action',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) =>
        row.original.readinessStatus === 'READY' ? (
          <div className="text-right">
            <Button
              variant="outline"
              size="sm"
              disabled={sending}
              onClick={() => onSend(row.original.serviceOrderId)}
            >
              Enviar
            </Button>
          </div>
        ) : null,
    },
  ]
}

export function FinanceBillingReadinessPage({
  statusFilter,
}: {
  statusFilter?: string
}) {
  const queryClient = useQueryClient()
  const queueQuery = useFinanceBillingReadinessData()

  const data = queueQuery.data
  const items = data?.data ?? []
  const connected = data?.billing.integrationState === 'connected'
  const canSend = Boolean(data?.billing.hasFinancialIntegrations && connected)

  const sendMutation = useMutation({
    mutationFn: async (serviceOrderIds: number[]) =>
      calibraApi.finance.sendBillingReadiness({ serviceOrderIds }),
    onSuccess: () => {
      toast.success('Ordens enviadas para o financeiro')
      for (const key of [
        ['finance', 'billing-readiness'],
        ['finance', 'documents'],
        ['finance', 'erp'],
        ['finance', 'overview'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' })
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const columns = useMemo(
    () =>
      makeReadinessColumns({
        sending: sendMutation.isPending,
        onSend: (id) => sendMutation.mutate([id]),
      }),
    [sendMutation],
  )

  const initialFilters: ColumnFiltersState = statusFilter
    ? [{ id: 'status', value: [statusFilter] }]
    : []

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SUMMARY_TILES.map((tile) => {
            const count = data?.summary[tile.key] ?? 0
            return (
              <Link
                key={tile.key}
                to="/dashboard/finance/billing-readiness"
                search={{ status: tile.status }}
                className="group block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <SignalTile
                  label={tile.label}
                  value={count}
                  tone={count > 0 ? tile.tone : 'neutral'}
                />
              </Link>
            )
          })}
        </div>
      </StaggerItem>

      {data && !canSend ? (
        <Alert>
          <AlertTitle>Envio ao financeiro indisponível</AlertTitle>
          <AlertDescription>
            {data.billing.hasFinancialIntegrations
              ? 'Conecte uma integração financeira para enviar as ordens prontas.'
              : 'As integrações financeiras fazem parte do plano Professional. Faça upgrade para enviar ao financeiro.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="Pronto para faturar"
            description="Trabalho concluído aguardando faturamento. Resolva os bloqueios e envie as ordens prontas."
          />
          <div className="mt-4">
            <FinanceDataTable
              key={`readiness:${statusFilter ?? ''}`}
              columns={columns}
              data={items}
              isLoading={queueQuery.isPending}
              getRowId={(row) => String(row.serviceOrderId)}
              searchPlaceholder="Buscar por cliente ou OS"
              facets={READINESS_FACETS}
              initialColumnFilters={initialFilters}
              initialSorting={[{ id: 'completedAt', desc: true }]}
              enableRowSelection={(row) =>
                canSend && row.original.readinessStatus === 'READY'
              }
              emptyState="Nenhuma ordem concluída aguardando faturamento."
              bulkActions={(selected, clear) => (
                <Button
                  size="sm"
                  className={ACTION_BUTTON_CLASS}
                  disabled={sendMutation.isPending}
                  onClick={() =>
                    sendMutation.mutate(
                      selected.map((item) => item.serviceOrderId),
                      { onSuccess: clear },
                    )
                  }
                >
                  Enviar para o financeiro ({selected.length})
                </Button>
              )}
            />
          </div>
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}
