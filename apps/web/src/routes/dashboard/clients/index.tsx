import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Building02Icon,
  PlusSignIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { DataTable } from '@/components/ui/data-table'
import { type Client, clientsColumns } from './-components/columns'
import { clientRouteId } from '@/lib/route-identifiers'

export const Route = createFileRoute('/dashboard/clients/')({
  head: () => ({
    meta: [{ title: 'Clientes | CalibraFácil' }],
  }),
  component: ClientsPage,
})

function ClientsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', page, limit, search],
    queryFn: async () => {
      const res = await api.api.customers.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar clientes')
      }

      return res.json() as Promise<{
        data: Client[]
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const handleRowClick = (client: Client) => {
    navigate({
      to: '/dashboard/clients/$id',
      params: { id: clientRouteId(client) },
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Clientes</CardTitle>
              <CardDescription>
                Gerencie os clientes do laboratório.
              </CardDescription>
            </div>
            <Button render={<Link to="/dashboard/clients/new" />}>
              <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
              Novo Cliente
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-sm">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                placeholder="Buscar por nome, CNPJ ou email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="text-destructive py-8 text-center">
              Erro ao carregar clientes. Tente novamente.
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && data?.data?.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Building02Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum cliente encontrado</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? 'Nenhum cliente corresponde a sua busca.'
                    : 'Comece adicionando seu primeiro cliente.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && (
                  <Button render={<Link to="/dashboard/clients/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Cliente
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          )}

          {/* Data table */}
          {!error && (data?.data?.length ?? 0) > 0 && (
            <DataTable
              columns={clientsColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
              onRowClick={handleRowClick}
            />
          )}

          {/* Loading state when no data yet */}
          {isLoading && !data && (
            <DataTable columns={clientsColumns} data={[]} isLoading={true} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
