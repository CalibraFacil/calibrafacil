import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle01Icon,
  PlugSocketIcon,
} from '@hugeicons/core-free-icons'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  AttentionRow,
  ConsoleEmpty,
  HealthDot,
  SectionPanel,
  StatusChip,
  type StatusDescriptor,
} from '@/features/backoffice/console'
import { useBackofficeIntegrationHealthData } from '@/features/backoffice/queries'
import type {
  BackofficeIntegrationAffected,
  BackofficeIntegrationProviderHealth,
} from '@/features/backoffice/types'

const PROVIDER_LABELS: Record<string, string> = {
  conta_azul: 'Conta Azul',
  generic_http: 'ERP (HTTP)',
}

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider
}

function statusDescriptor(status: string): StatusDescriptor {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Ativa', tone: 'ok' }
    case 'ACTION_REQUIRED':
      return { label: 'Ação necessária', tone: 'critical' }
    case 'DISABLED':
      return { label: 'Desativada', tone: 'neutral' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

export function IntegrationHealthPanel() {
  const query = useBackofficeIntegrationHealthData()
  const providers = query.data?.providers ?? []
  const affected = query.data?.affected ?? []
  const brokenCount = providers.reduce((sum, p) => sum + p.actionRequired, 0)

  return (
    <SectionPanel
      eyebrow="Integrações"
      title="Saúde das integrações"
      description="Conexões de ERP / Conta Azul, revalidadas automaticamente a cada 30 minutos."
      action={
        brokenCount > 0 ? (
          <StatusChip tone="critical">{brokenCount} com problema</StatusChip>
        ) : !query.isPending ? (
          <StatusChip tone="ok" icon={CheckmarkCircle01Icon}>
            Tudo conectado
          </StatusChip>
        ) : null
      }
      contentClassName="space-y-4"
    >
      {query.isPending ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : providers.length === 0 ? (
        <ConsoleEmpty
          icon={PlugSocketIcon}
          title="Nenhuma integração conectada"
          description="Quando os laboratórios conectarem ERP ou Conta Azul, a saúde aparece aqui."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((provider) => (
              <ProviderTile key={provider.provider} provider={provider} />
            ))}
          </div>

          {affected.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Contas afetadas
              </p>
              {affected.slice(0, 6).map((item) => (
                <AffectedRow
                  key={`${item.organizationId}-${item.provider}-${item.name}`}
                  item={item}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </SectionPanel>
  )
}

function ProviderTile({
  provider,
}: {
  provider: BackofficeIntegrationProviderHealth
}) {
  const broken = provider.actionRequired > 0
  return (
    <div
      className={cn(
        'rounded-xl p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
        broken ? 'bg-destructive/5' : 'bg-muted/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <HugeiconsIcon
            icon={PlugSocketIcon}
            className="size-4 text-muted-foreground"
          />
          {providerLabel(provider.provider)}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {provider.total}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <HealthDot tone="ok" />
          <span className="font-mono tabular-nums">{provider.active}</span>
          <span className="text-muted-foreground">ativas</span>
        </span>
        <span className="flex items-center gap-1.5">
          <HealthDot tone={broken ? 'critical' : 'neutral'} />
          <span
            className={cn(
              'font-mono tabular-nums',
              broken && 'font-semibold text-destructive',
            )}
          >
            {provider.actionRequired}
          </span>
          <span className="text-muted-foreground">com problema</span>
        </span>
        {provider.disabled > 0 ? (
          <span className="flex items-center gap-1.5">
            <HealthDot tone="neutral" />
            <span className="font-mono tabular-nums">{provider.disabled}</span>
            <span className="text-muted-foreground">desativadas</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

function AffectedRow({ item }: { item: BackofficeIntegrationAffected }) {
  const descriptor = statusDescriptor(item.status)
  return (
    <AttentionRow
      render={
        <Link
          to="/backoffice/accounts/$id"
          params={{ id: item.organizationId }}
        />
      }
      tone={descriptor.tone}
      icon={PlugSocketIcon}
      title={
        <>
          <span className="truncate">{item.organizationName}</span>
          <StatusChip status={descriptor} />
        </>
      }
      subtitle={`${providerLabel(item.provider)}${
        item.lastValidationError ? ` · ${item.lastValidationError}` : ''
      }`}
    />
  )
}
