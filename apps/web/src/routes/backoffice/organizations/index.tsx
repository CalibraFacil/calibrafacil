import { createFileRoute, Link } from '@tanstack/react-router'

import {
  loadBackofficeOrganizationsData,
  useBackofficeOrganizationsData,
} from '@/features/backoffice/queries'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/backoffice/organizations/')({
  loader: ({ context }) => loadBackofficeOrganizationsData(context.queryClient),
  component: BackofficeOrganizationsPage,
})

function BackofficeOrganizationsPage() {
  const organizationsQuery = useBackofficeOrganizationsData('list')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Organizações</h1>
        <p className="text-sm text-muted-foreground">
          Visão consolidada das contas LAB, unidades, integrações e suporte.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contas LAB</CardTitle>
          <CardDescription>
            Use esta área para inspecionar o estado operacional de cada conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {organizationsQuery.isPending
            ? Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))
            : organizationsQuery.data?.data.map((org) => (
                <div
                  key={org.id}
                  className="rounded-lg border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{org.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {org.slug}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Onboarding: {org.onboardingStatus ?? 'Não iniciado'} ·
                        Migração: {org.migrationStatus ?? 'Não necessário'}
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground md:text-right">
                      <p>{org.unitsCount} unidades</p>
                      <p>{org.integrationsCount} integrações</p>
                      <p>{org.openRequestsCount} solicitações abertas</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Link
                      to="/backoffice/organizations/$id"
                      params={{ id: org.id }}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Abrir organização
                    </Link>
                  </div>
                </div>
              ))}
        </CardContent>
      </Card>
    </div>
  )
}
