import { useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ServerStack01Icon } from '@hugeicons/core-free-icons'

import { useActiveOrganization, useSession } from '@calibra-facil/auth/client'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import {
  canManageIntegrationSettings,
  getIntegrationSettingsRole,
} from '@/features/settings/integrations-model'
import { useIntegrationsData } from '@/features/settings/queries'
import type { IntegrationSummary } from '@/features/settings/types'
import { ContaAzulCard } from './integrations/conta-azul-card'
import {
  GenericConnectorCard,
  NewGenericConnectorForm,
} from './integrations/generic-connector'
import { SectionTitle } from './integrations/shared'

export function IntegrationsSettingsPage() {
  const queryClient = useQueryClient()
  const { data: session, isPending: isLoadingSession } = useSession()
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()
  const currentOrgRole = getIntegrationSettingsRole(
    session?.user?.id,
    activeOrg?.members,
  )
  const canManage = canManageIntegrationSettings(currentOrgRole)

  const integrationsQuery = useIntegrationsData({ enabled: canManage })

  const refreshIntegrations = async () => {
    // Refresh integration status/overview after a mutation, but NOT the
    // Conta Azul reference catalogs: those are provider-side data a sync or
    // status change can't affect, and they live under the same ['integrations']
    // prefix. They're refreshed explicitly via refreshCatalogs() on
    // connect/token-refresh/manual, so exclude them here to avoid firing all
    // ~15 catalog requests on every sync.
    await queryClient.invalidateQueries({
      queryKey: ['integrations'],
      predicate: (query) => query.queryKey[3] !== 'catalog',
    })
  }

  if (isLoadingOrg || isLoadingSession) {
    return <IntegrationsSkeleton />
  }

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrações</CardTitle>
          <CardDescription>
            Apenas administradores globais podem gerenciar integrações.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (integrationsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrações</CardTitle>
          <CardDescription>
            {integrationsQuery.error instanceof Error
              ? integrationsQuery.error.message
              : 'Falha ao carregar integrações'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (integrationsQuery.isLoading || !integrationsQuery.data) {
    return <IntegrationsSkeleton />
  }

  const payload = integrationsQuery.data
  const contaAzulIntegration =
    payload.data.find((item) => item.provider === 'conta_azul') ?? null
  const genericIntegrations = payload.data.filter(
    (item) => item.provider !== 'conta_azul',
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-balance">
            Integrações
          </h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Conecte o CalibraFácil ao seu ERP financeiro para sincronizar
            pessoas, catálogo, faturamento e fiscal.
          </p>
        </div>
      </header>

      <ContaAzulCard
        integration={contaAzulIntegration}
        onRefresh={refreshIntegrations}
      />

      <GenericConnectorsSection
        integrations={genericIntegrations}
        defaultOpen={genericIntegrations.length > 0 || !contaAzulIntegration}
        onRefresh={refreshIntegrations}
      />
    </div>
  )
}

function GenericConnectorsSection({
  defaultOpen,
  integrations,
  onRefresh,
}: {
  defaultOpen: boolean
  integrations: IntegrationSummary[]
  onRefresh: () => Promise<void>
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <Card className="gap-0 p-0">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="group/generic flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            />
          }
        >
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border/60">
              <HugeiconsIcon icon={ServerStack01Icon} className="size-4" />
            </span>
            <div className="space-y-0.5">
              <CardTitle className="text-sm">Conector HTTP genérico</CardTitle>
              <CardDescription className="text-xs">
                Para ERPs com middleware HTTP próprio.{' '}
                {integrations.length > 0
                  ? `${integrations.length} conector(es).`
                  : 'Nenhum configurado.'}
              </CardDescription>
            </div>
          </div>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/generic:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-6 border-t px-6 py-6">
            <section className="space-y-3">
              <SectionTitle
                title="Novo conector"
                description="Configure o endpoint HTTP que receberá os payloads normalizados."
              />
              <NewGenericConnectorForm onRefresh={onRefresh} />
            </section>

            {integrations.map((integration) => (
              <GenericConnectorCard
                key={integration.id}
                integration={integration}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

function IntegrationsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
