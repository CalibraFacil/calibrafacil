import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  getCommercialAgreementStatusLabel,
  type CommercialAgreementStatus,
} from '@calibra-facil/shared'

import { CommercialAgreementStatusBadge } from '@/components/finance-status-badges'
import { formatFinanceDate } from '@/lib/finance-formatters'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
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
import { toast } from 'sonner'
import {
  FinanceDataTable,
  type FacetConfig,
} from '@/features/finance/components/finance-data-table'
import { useFinanceContractsData } from '@/features/finance/queries'
import {
  useActivateContractMutation,
  useCancelContractMutation,
} from '@/features/finance/mutations'
import type { ContractListItem } from '@/features/finance/types'

const CONTRACT_STATUSES: CommercialAgreementStatus[] = [
  'DRAFT',
  'ACTIVE',
  'EXPIRED',
  'CANCELED',
]

const STATUS_FACETS: FacetConfig[] = [
  {
    columnId: 'status',
    title: 'Status',
    options: CONTRACT_STATUSES.map((value) => ({
      value,
      label: getCommercialAgreementStatusLabel(value),
    })),
  },
]

function makeContractColumns({
  onActivate,
  onCancel,
  activating,
}: {
  onActivate: (id: number) => void
  onCancel: (contract: ContractListItem) => void
  activating: boolean
}): ColumnDef<ContractListItem, unknown>[] {
  return [
    {
      accessorKey: 'title',
      id: 'title',
      header: 'Contrato',
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <Link
            to="/dashboard/finance/contracts/$id"
            params={{ id: String(row.original.id) }}
            className="font-medium hover:underline"
          >
            {row.original.title}
          </Link>
          <div className="text-xs text-muted-foreground">
            {row.original.agreementCode || `Contrato #${row.original.id}`}
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
        <CommercialAgreementStatusBadge status={row.original.status} />
      ),
    },
    {
      accessorKey: 'effectiveFrom',
      id: 'effectiveFrom',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Vigência" />
      ),
      meta: { label: 'Vigência' },
      cell: ({ row }) => (
        <div>
          {formatFinanceDate(row.original.effectiveFrom)}
          <div className="text-xs text-muted-foreground">
            {row.original.effectiveTo
              ? `até ${formatFinanceDate(row.original.effectiveTo)}`
              : 'sem término'}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'defaultPaymentTermDays',
      id: 'defaultPaymentTermDays',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Prazo" />
      ),
      meta: { label: 'Prazo' },
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.defaultPaymentTermDays} dias
        </span>
      ),
    },
    {
      id: 'action',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const status = row.original.status
        if (status === 'DRAFT') {
          return (
            <div className="text-right">
              <Button
                variant="outline"
                size="sm"
                disabled={activating}
                onClick={() => onActivate(row.original.id)}
              >
                Ativar
              </Button>
            </div>
          )
        }
        if (status === 'ACTIVE') {
          return (
            <div className="text-right">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCancel(row.original)}
              >
                Cancelar
              </Button>
            </div>
          )
        }
        return null
      },
    },
  ]
}

export function FinanceContractsPage() {
  const navigate = useNavigate()
  const contractsQuery = useFinanceContractsData({ search: '' })
  const activateMutation = useActivateContractMutation()
  const cancelMutation = useCancelContractMutation()
  const [cancelTarget, setCancelTarget] = useState<ContractListItem | null>(
    null,
  )

  const columns = useMemo(
    () =>
      makeContractColumns({
        activating: activateMutation.isPending,
        onActivate: (id) =>
          activateMutation.mutate(id, {
            onSuccess: () => toast.success('Contrato ativado'),
          }),
        onCancel: (contract) => setCancelTarget(contract),
      }),
    [activateMutation],
  )

  const contracts = contractsQuery.data?.data ?? []

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="Contratos"
            description="Preços negociados, vigência e condições comerciais por cliente."
            action={
              <Button
                render={<Link to="/dashboard/finance/contracts/new" />}
                type="button"
                size="sm"
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
                Novo contrato
              </Button>
            }
          />
          <div className="mt-4">
            <FinanceDataTable
              columns={columns}
              data={contracts}
              isLoading={contractsQuery.isPending}
              getRowId={(row) => String(row.id)}
              searchPlaceholder="Buscar por cliente, título ou código"
              facets={STATUS_FACETS}
              initialSorting={[{ id: 'effectiveFrom', desc: true }]}
              onRowClick={(row) =>
                navigate({
                  to: '/dashboard/finance/contracts/$id',
                  params: { id: String(row.id) },
                })
              }
              emptyState="Nenhum contrato para os filtros atuais."
            />
          </div>
        </Panel>
      </StaggerItem>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar contrato</DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `O cancelamento de "${cancelTarget.title}" encerra o contrato e interrompe novos snapshots comerciais. Esta ação não pode ser desfeita.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelTarget(null)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (!cancelTarget) return
                cancelMutation.mutate(cancelTarget.id, {
                  onSuccess: () => {
                    toast.success('Contrato cancelado')
                    setCancelTarget(null)
                  },
                })
              }}
            >
              {cancelMutation.isPending
                ? 'Cancelando…'
                : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  )
}
