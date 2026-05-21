import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { ClipboardIcon, PlusSignIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import {
  CALIBRATION_REQUESTS_LIST_LIMIT,
  useCalibrationRequestsListData,
} from '@/features/requests/queries'
import {
  CALIBRATION_REQUEST_STATUSES,
  type CalibrationRequestListItem,
  type CalibrationRequestStatus,
} from '@/features/requests/types'
const statusLabels: Record<CalibrationRequestStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CONVERTED: 'Convertida',
}

const statusVariants: Record<
  CalibrationRequestStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  UNDER_REVIEW: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CONVERTED: 'outline',
}

function formatDate(date: string | null | undefined) {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('pt-BR')
}

export function RequestsPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...CALIBRATION_REQUEST_STATUSES, '']).withDefault(''),
  )

  const { data, isLoading, error } = useCalibrationRequestsListData({
    activeOrganizationId,
    enabled:
      Boolean(activeOrganizationId) &&
      !isContextSwitching &&
      !cloudOnlyUnavailable,
    page,
    limit: CALIBRATION_REQUESTS_LIST_LIMIT,
    search,
    statusFilter,
  })

  const columns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Solicitação',
        cell: ({ row }: { row: { original: CalibrationRequestListItem } }) => (
          <Link
            to="/dashboard/requests/$id"
            params={{ id: String(row.original.id) }}
            className="font-medium hover:underline"
          >
            #{row.original.id}
          </Link>
        ),
      },
      {
        accessorKey: 'customerName',
        header: 'Cliente',
      },
      {
        accessorKey: 'itemCount',
        header: 'Itens',
        cell: ({ row }: { row: { original: CalibrationRequestListItem } }) =>
          `${row.original.itemCount} ativo(s)`,
      },
      {
        accessorKey: 'requestedDueDate',
        header: 'Prazo solicitado',
        cell: ({ row }: { row: { original: CalibrationRequestListItem } }) =>
          formatDate(row.original.requestedDueDate),
      },
      {
        accessorKey: 'submittedAt',
        header: 'Enviada em',
        cell: ({ row }: { row: { original: CalibrationRequestListItem } }) =>
          formatDate(row.original.submittedAt),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }: { row: { original: CalibrationRequestListItem } }) => (
          <Badge variant={statusVariants[row.original.status]}>
            {statusLabels[row.original.status]}
          </Badge>
        ),
      },
    ],
    [],
  )

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-destructive">
          Erro ao carregar solicitações: {error.message}
        </CardContent>
      </Card>
    )
  }

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="Solicitações indisponíveis offline" />
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Solicitações de Calibração</CardTitle>
              <CardDescription>
                Revise, aprove e converta as solicitações enviadas pelos
                clientes.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              render={
                <Link to="/dashboard/jobs/new">
                  <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                  Nova Calibração Manual
                </Link>
              }
            ></Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Input
              placeholder="Buscar por observações..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              className="sm:max-w-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant={statusFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setStatusFilter('')
                  setPage(1)
                }}
              >
                Todas
              </Button>
              {Object.entries(statusLabels).map(([value, label]) => (
                <Button
                  key={value}
                  variant={statusFilter === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    // oxlint-disable-next-line typescript/consistent-type-assertions -- Buttons are generated from calibration request status labels.
                    setStatusFilter(value as CalibrationRequestStatus)
                    setPage(1)
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {!isLoading && data?.data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={ClipboardIcon} />
                </EmptyMedia>
                <EmptyTitle>
                  Nenhuma solicitação de calibração encontrada
                </EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhuma solicitação encontrada para os filtros aplicados.'
                    : 'As solicitações enviadas pelos clientes aparecerão aqui para revisão.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {search || statusFilter ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setPage(1)
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button render={<Link to="/dashboard/jobs/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Nova Calibração Manual
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <DataTable
              columns={columns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
