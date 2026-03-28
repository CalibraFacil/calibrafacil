import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/utils/api'

export const Route = createFileRoute('/backoffice/organizations/$id')({
  component: BackofficeOrganizationDetailPage,
})

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

      return res.json() as Promise<{
        organization: {
          id: string
          name: string
          slug: string
          type: string | null
          cnpj: string | null
        }
        units: Array<{ id: number; name: string; status: string; cnpj: string | null }>
        integrations: Array<{ id: number; name: string; provider: string; status: string }>
        successProfile: {
          onboardingStatus: string
          migrationStatus: string
          accountOwnerName: string | null
          supportContactEmail: string | null
        } | null
        support: {
          total: number
          open: number
        }
        plan: {
          planId: string
          planName: string
          status: string
        }
      }>
    },
  })

  const data = organizationQuery.data

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
            <p className="text-sm text-muted-foreground">
              {data.organization.slug} · Plano {data.plan.planName} ({data.plan.status})
            </p>
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
              <CardTitle>Unidades</CardTitle>
              <CardDescription>
                Instalações operacionais e acreditáveis da organização.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.units.map((unit) => (
                <div key={unit.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{unit.name}</p>
                  <p className="text-muted-foreground">
                    {unit.status} · CNPJ {unit.cnpj || 'Não definido'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
