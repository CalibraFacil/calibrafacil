import { Link, createFileRoute } from '@tanstack/react-router'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { useDashboardContextState } from '@/contexts/dashboard-context'

export const Route = createFileRoute('/dashboard/requests/')({
  head: () => ({
    meta: [{ title: 'Solicitações de Calibração | CalibraFácil' }],
  }),
  component: RequestsPage,
})

type RequestStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED'

type CalibrationRequest = {
  id: number
  status: RequestStatus
  observations: string | null
  requestedDueDate: string | null
  submittedAt: string
  reviewedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  convertedAt: string | null
  customerId: number
  customerName: string
  submittedByName: string | null
  itemCount: number
}

const statusLabels: Record<RequestStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CONVERTED: 'Convertida',
}

const statusVariants: Record<
  RequestStatus,
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

function RequestsPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const organizationQueryKey = activeOrganizationId ?? 'no-org'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RequestStatus | ''>('')
  const deferredSearch = useDeferredValue(search.trim())
  const limit = 20

  useEffect(() => {
    setPage(1)
  }, [deferredSearch])

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'calibration-requests',
      organizationQueryKey,
      page,
      deferredSearch,
      statusFilter,
    ],
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    queryFn: async () => {
      const res = await api.api['calibration-requests'].$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: deferredSearch || undefined,
          status: statusFilter || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar solicitações')
      }

      return res.json() as Promise<{
        data: Array<CalibrationRequest>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const columns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Solicitação',
        cell: ({ row }: { row: { original: CalibrationRequest } }) => (
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
        cell: ({ row }: { row: { original: CalibrationRequest } }) =>
          `${row.original.itemCount} ativo(s)`,
      },
      {
        accessorKey: 'requestedDueDate',
        header: 'Prazo solicitado',
        cell: ({ row }: { row: { original: CalibrationRequest } }) =>
          formatDate(row.original.requestedDueDate),
      },
      {
        accessorKey: 'submittedAt',
        header: 'Enviada em',
        cell: ({ row }: { row: { original: CalibrationRequest } }) =>
          formatDate(row.original.submittedAt),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }: { row: { original: CalibrationRequest } }) => (
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
              render={<Link to="/dashboard/jobs/new" />}
            >
              Nova OS Manual
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Input
              placeholder="Buscar por observações..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
                    setStatusFilter(value as RequestStatus)
                    setPage(1)
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <DataTable
            columns={columns}
            data={data?.data ?? []}
            isLoading={isLoading}
            pagination={data?.pagination}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  )
}
