import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { calibraApi } from '@/utils/api'

export const Route = createFileRoute('/backoffice/')({
  component: BackofficeIndexPage,
})

function BackofficeIndexPage() {
  const organizationsQuery = useQuery({
    queryKey: ['backoffice', 'organizations', 'summary'],
    queryFn: async () =>
      calibraApi.backoffice.listOrganizations<{
        data: Array<{
          id: string
          openRequestsCount: number
          integrationsCount: number
        }>
      }>(),
  })

  const supportQuery = useQuery({
    queryKey: ['backoffice', 'support', 'queue', 'summary'],
    queryFn: async () =>
      calibraApi.backoffice.getSupportQueue<{ data: Array<unknown> }>(),
  })

  const orgsCount = organizationsQuery.data?.data.length ?? 0
  const openRequests =
    organizationsQuery.data?.data.reduce(
      (total, org) => total + Number(org.openRequestsCount ?? 0),
      0,
    ) ?? 0
  const integrationsCount =
    organizationsQuery.data?.data.reduce(
      (total, org) => total + Number(org.integrationsCount ?? 0),
      0,
    ) ?? 0
  const queueCount = supportQuery.data?.data.length ?? 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Operação da Plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral do atendimento, contas e governança interna.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Organizações"
          value={orgsCount}
          description="Contas LAB ativas na plataforma"
          loading={organizationsQuery.isPending}
          to="/backoffice/organizations"
        />
        <SummaryCard
          title="Fila de suporte"
          value={queueCount}
          description="Solicitações operacionais recentes"
          loading={supportQuery.isPending}
          to="/backoffice/support"
        />
        <SummaryCard
          title="Solicitações abertas"
          value={openRequests}
          description="Pedidos aguardando tratamento"
          loading={organizationsQuery.isPending}
          to="/backoffice/customer-success"
        />
        <SummaryCard
          title="Integrações"
          value={integrationsCount}
          description="Conexões configuradas nas contas"
          loading={organizationsQuery.isPending}
          to="/backoffice/organizations"
        />
      </div>
    </div>
  )
}

function SummaryCard(props: {
  title: string
  value: number
  description: string
  loading?: boolean
  to: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-3xl font-semibold">{props.value}</p>
        )}
        <Link
          to={props.to}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Abrir área
        </Link>
      </CardContent>
    </Card>
  )
}
