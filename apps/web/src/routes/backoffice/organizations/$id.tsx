import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { InferResponseType } from 'hono/client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/utils/api'

export const Route = createFileRoute('/backoffice/organizations/$id')({
  component: BackofficeOrganizationDetailPage,
})

type OrganizationDetailRequest =
  (typeof api.api.backoffice.organizations)[':id']['$get']
type OrganizationDetailResponse = InferResponseType<
  OrganizationDetailRequest,
  200
>

function BackofficeOrganizationDetailPage() {
  const { id } = Route.useParams()
  const organizationQuery = useQuery({
    queryKey: ['backoffice', 'organizations', id],
    queryFn: async () => {
      const res = await api.api.backoffice.organizations[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar organização')
      }

      return res.json() as Promise<OrganizationDetailResponse>
    },
  })

  const data = organizationQuery.data
  const activeUnitsCount =
    data?.units.filter((unit) => unit.status === 'ACTIVE').length ?? 0
  const archivedUnitsCount =
    data?.units.filter((unit) => unit.status !== 'ACTIVE').length ?? 0
  const isMultiUnit = (data?.units.length ?? 0) > 1

  return (
    <div className="space-y-4">
      {organizationQuery.isPending ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-52 w-full" />
        </>
      ) : data ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{data.organization.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{data.organization.slug}</Badge>
              <Badge variant="outline">
                Plano {data.plan.planName} ({data.plan.status})
              </Badge>
              <Badge variant="outline">
                {isMultiUnit ? 'Conta multiunidade' : 'Conta mono-unidade'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/backoffice/commercial-checkouts"
                    search={{ organizationId: data.organization.id }}
                  />
                }
              >
                Abrir comercial
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Conta</CardTitle>
                <CardDescription>Identidade global da organização.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>CNPJ: {data.organization.cnpj || 'Não definido'}</p>
                <p>
                  Onboarding: {data.successProfile?.onboardingStatus || 'NOT_STARTED'}
                </p>
                <p>Migração: {data.successProfile?.migrationStatus || 'NOT_REQUIRED'}</p>
                <p>
                  Owner interno: {data.successProfile?.accountOwnerName || 'A definir'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Suporte</CardTitle>
                <CardDescription>Estado operacional da conta.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{data.support.open} solicitações abertas</p>
                <p>{data.support.total} solicitações registradas</p>
                <p>
                  Contato: {data.successProfile?.supportContactEmail || 'A definir'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Integrações</CardTitle>
                <CardDescription>Conexões configuradas para a conta.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{data.integrations.length} integração(ões)</p>
                {data.integrations.slice(0, 3).map((integration) => (
                  <p key={integration.id}>
                    {integration.name} · {integration.status}
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Postura Multiunidade</CardTitle>
              <CardDescription>
                Leitura operacional da estrutura de unidades e do estágio atual
                da conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Cobertura operacional</p>
                <p className="mt-2 text-2xl font-semibold">{data.units.length}</p>
                <p className="text-sm text-muted-foreground">
                  unidade(s) cadastrada(s)
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Unidades ativas</p>
                <p className="mt-2 text-2xl font-semibold">{activeUnitsCount}</p>
                <p className="text-sm text-muted-foreground">
                  {archivedUnitsCount} arquivada(s)
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Capacidade operacional</p>
                <p className="mt-2 text-2xl font-semibold">
                  {data.integrations.length + data.support.open}
                </p>
                <p className="text-sm text-muted-foreground">
                  sinais combinados de integrações e suporte em aberto
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unidades</CardTitle>
              <CardDescription>
                Instalações operacionais e acreditáveis da organização.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.units.map((unit) => (
                <div key={unit.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{unit.name}</p>
                      <p className="text-muted-foreground">
                        Slug {unit.slug}
                      </p>
                    </div>
                    <Badge variant={unit.status === 'ACTIVE' ? 'default' : 'secondary'}>
                      {unit.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
