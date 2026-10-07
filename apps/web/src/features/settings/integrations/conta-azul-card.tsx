import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  CheckmarkBadge01Icon,
  CloudDownloadIcon,
  Key01Icon,
  LinkForwardIcon,
  Logout03Icon,
  MoreHorizontalIcon,
  PowerSocket02Icon,
  RefreshDotIcon,
} from '@hugeicons/core-free-icons'

import type { ContaAzulConnectionConfig } from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  formatIntegrationDateTime,
  getSharedIntegrationWarnings,
  integrationReadinessBadgeVariant,
  integrationStatusBadgeMeta,
} from '@/features/settings/integrations-model'
import { contaAzulAppQueryOptions } from '@/features/settings/queries'
import type {
  ContaAzulScheduleResponse,
  ContaAzulOAuthStartResponse,
  IntegrationSummary,
} from '@/features/settings/types'
import {
  ContaAzulAppDialog,
  ContaAzulAppSetup,
  ContaAzulAppStatus,
} from './conta-azul-app-setup'
import { contaAzulOAuthErrorMessage } from './conta-azul-app-form'
import { useContaAzulCatalogs } from './conta-azul-catalogs'
import { useContaAzulMutations } from './conta-azul-mutations'
import { useConnectorMutations } from './mutations'
import {
  contaAzulCapabilities,
  CONTA_AZUL_BRAND,
  getContaAzulCapabilityChips,
} from './conta-azul-constants'
import {
  ContaAzulDefaultsTab,
  ContaAzulOverviewTab,
  ContaAzulSyncTab,
} from './conta-azul-tabs'
import { IntegrationActivity } from './activity'
import { ContaAzulLogo, LiveDot } from './shared'

function getContaAzulConfig(
  integration: IntegrationSummary,
): ContaAzulConnectionConfig | null {
  const config = integration.connection.config
  if (!config || !('provider' in config) || config.provider !== 'conta_azul') {
    return null
  }
  return config
}

export function ContaAzulCard({
  integration,
  onRefresh,
  oauthError = null,
}: {
  integration: IntegrationSummary | null
  onRefresh: () => Promise<void>
  /** Set when the OAuth callback sent the browser back with an error. */
  oauthError?: { reason: string | null } | null
}) {
  return (
    <div className="space-y-3">
      {oauthError ? (
        <Alert variant="destructive">
          <AlertDescription className="text-pretty">
            {contaAzulOAuthErrorMessage(oauthError.reason)}
          </AlertDescription>
        </Alert>
      ) : null}
      <ContaAzulCardBody integration={integration} onRefresh={onRefresh} />
    </div>
  )
}

function ContaAzulCardBody({
  integration,
  onRefresh,
}: {
  integration: IntegrationSummary | null
  onRefresh: () => Promise<void>
}) {
  if (!integration) {
    return <ContaAzulConnect onRefresh={onRefresh} />
  }

  const config = getContaAzulConfig(integration)
  if (!config) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <ContaAzulLogo />
            <div className="space-y-1">
              <p className="text-sm font-semibold">Conta Azul</p>
              <p className="max-w-md text-xs text-pretty text-muted-foreground">
                A conexão OAuth perdeu a configuração nativa. Reconecte a conta
                para restaurar pessoas, financeiro e fiscal.
              </p>
            </div>
          </div>
          <ContaAzulConnect compact onRefresh={onRefresh} />
        </CardContent>
      </Card>
    )
  }

  return (
    <ContaAzulPanel
      config={config}
      integration={integration}
      onRefresh={onRefresh}
    />
  )
}

// ── Disconnected hero ─────────────────────────────────────────────────────────

function ContaAzulConnect({
  compact,
  onRefresh,
}: {
  compact?: boolean
  onRefresh: () => Promise<void>
}) {
  const appQuery = useQuery(contaAzulAppQueryOptions())
  const oauthMutation = useMutation({
    mutationFn: async () =>
      calibraApi.integrations.startContaAzulOAuth<ContaAzulOAuthStartResponse>({
        returnTo: '/dashboard/settings/integrations',
      }),
    onSuccess: (data) => {
      window.location.assign(data.authorizationUrl)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao iniciar conexão Conta Azul',
      )
    },
  })

  const connectButton = (
    <Button
      onClick={() => oauthMutation.mutate()}
      disabled={oauthMutation.isPending}
      className="bg-[#2687e9] text-white shadow-xs transition-[background-color,transform] hover:bg-[#1f6fc4] active:scale-[0.96] disabled:opacity-60"
    >
      <HugeiconsIcon icon={LinkForwardIcon} className="mr-2 size-4" />
      {oauthMutation.isPending ? 'Abrindo OAuth…' : 'Conectar Conta Azul'}
    </Button>
  )

  if (compact) {
    return connectButton
  }

  return (
    <Card className="overflow-hidden pt-0">
      <div
        className="relative border-b px-6 py-6"
        style={{
          background: `linear-gradient(135deg, ${CONTA_AZUL_BRAND}14, transparent 60%)`,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
          className="flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3.5">
            <ContaAzulLogo />
            <div className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight text-balance">
                Conta Azul
              </h2>
              <p className="max-w-md text-sm text-pretty text-muted-foreground">
                Conexão OAuth para pessoas, catálogo, comercial, financeiro,
                fiscal, documentos e reconciliação — sem middleware HTTP.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
            <LiveDot active={false} />
            Não conectada
          </span>
        </motion.div>
      </div>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {contaAzulCapabilities.map((capability, index) => (
            <motion.div
              key={capability.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                duration: 0.4,
                bounce: 0,
                delay: 0.05 + index * 0.04,
              }}
              className="flex items-start gap-2.5 rounded-lg bg-muted/40 p-3 ring-1 ring-inset ring-border/60"
            >
              <HugeiconsIcon
                icon={capability.icon}
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-none">
                  {capability.label}
                </p>
                <p className="mt-1 text-xs text-pretty text-muted-foreground">
                  {capability.value}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {appQuery.isPending ? (
          <Skeleton className="h-9 w-48" />
        ) : appQuery.data?.source === null ? (
          <ContaAzulAppSetup app={appQuery.data} onChanged={onRefresh} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {connectButton}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <HugeiconsIcon
                  icon={CheckmarkBadge01Icon}
                  className="size-3.5"
                />
                OAuth 2.0 oficial
              </span>
            </div>
            {appQuery.data ? (
              <ContaAzulAppStatus app={appQuery.data} onChanged={onRefresh} />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Connected panel ───────────────────────────────────────────────────────────

function ContaAzulPanel({
  config,
  integration,
  onRefresh,
}: {
  config: ContaAzulConnectionConfig
  integration: IntegrationSummary
  onRefresh: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [appDialogOpen, setAppDialogOpen] = useState(false)
  const appQuery = useQuery({
    ...contaAzulAppQueryOptions(),
    enabled: appDialogOpen,
  })
  const catalogs = useContaAzulCatalogs({
    integrationId: integration.id,
    enabled: true,
  })

  const refreshCatalogs = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['integrations', integration.id, 'conta-azul', 'catalog'],
    })
  }

  const connector = useConnectorMutations({
    integrationId: integration.id,
    onRefresh,
  })
  const native = useContaAzulMutations({
    integrationId: integration.id,
    onRefresh,
    refreshCatalogs,
  })
  const scheduleQuery = useQuery({
    queryKey: ['integrations', integration.id, 'conta-azul', 'schedule'],
    queryFn: () =>
      calibraApi.integrations.getContaAzulSchedule<ContaAzulScheduleResponse>(
        integration.id,
      ),
    enabled: integration.status === 'ACTIVE',
  })

  const isBusy =
    connector.validate.isPending ||
    connector.toggle.isPending ||
    native.config.isPending ||
    native.pollReceivables.isPending ||
    native.pollPayables.isPending ||
    native.pollFiscal.isPending ||
    native.pollProtocols.isPending ||
    native.pollDrift.isPending ||
    native.refreshToken.isPending ||
    native.disconnect.isPending
  const disabled = isBusy

  const statusBadge = integrationStatusBadgeMeta(integration)
  const readiness = integration.overview.readiness.readinessStatus
  const sharedWarnings = getSharedIntegrationWarnings(integration)
  const capabilityChips = getContaAzulCapabilityChips(
    integration.overview.readiness.capabilities,
  )
  const companyName =
    config.connectedCompanyName ?? integration.name ?? 'Conta Azul'

  return (
    <Collapsible defaultOpen>
      <Card className="gap-0 overflow-hidden p-0">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
          className="relative px-6 py-5"
          style={{
            background: `linear-gradient(135deg, ${CONTA_AZUL_BRAND}12, transparent 55%)`,
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="group/ca flex items-center gap-3.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label="Mostrar ou ocultar detalhes da Conta Azul"
                />
              }
            >
              <ContaAzulLogo />
              <div className="space-y-1">
                <span className="block text-base font-semibold tracking-tight text-balance">
                  {companyName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Token válido até{' '}
                  <span className="tabular-nums">
                    {formatIntegrationDateTime(config.accessTokenExpiresAt)}
                  </span>
                </span>
              </div>
            </CollapsibleTrigger>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-400">
                <LiveDot active />
                Conectada
              </span>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              <Badge variant={integrationReadinessBadgeVariant(readiness)}>
                {readiness === 'READY'
                  ? 'Pronta'
                  : readiness === 'DEGRADED'
                    ? 'Com dependências'
                    : 'Não pronta'}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 active:scale-[0.96]"
                      aria-label="Ações da Conta Azul"
                    />
                  }
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={() => connector.validate.mutate()}
                    disabled={disabled}
                  >
                    <HugeiconsIcon icon={CheckmarkBadge01Icon} />
                    Validar conexão
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      connector.toggle.mutate({
                        enabled: integration.status !== 'ACTIVE',
                      })
                    }
                    disabled={
                      disabled || integration.status === 'ACTION_REQUIRED'
                    }
                  >
                    <HugeiconsIcon icon={PowerSocket02Icon} />
                    {integration.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => native.refreshToken.mutate()}
                    disabled={disabled}
                  >
                    <HugeiconsIcon icon={RefreshDotIcon} />
                    Renovar token
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => refreshCatalogs()}
                    disabled={disabled}
                  >
                    <HugeiconsIcon icon={CloudDownloadIcon} />
                    Recarregar catálogos
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAppDialogOpen(true)}>
                    <HugeiconsIcon icon={Key01Icon} />
                    Aplicativo Conta Azul
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => native.disconnect.mutate()}
                    disabled={disabled}
                  >
                    <HugeiconsIcon icon={Logout03Icon} />
                    Desconectar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ContaAzulAppDialog
                app={appQuery.data}
                connected
                open={appDialogOpen}
                onOpenChange={setAppDialogOpen}
                onChanged={onRefresh}
              />
              <CollapsibleTrigger
                render={
                  <button
                    type="button"
                    className="group/cachev inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
                    aria-label="Mostrar ou ocultar detalhes da Conta Azul"
                  />
                }
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="size-4 transition-transform group-aria-expanded/cachev:rotate-180"
                />
              </CollapsibleTrigger>
            </div>
          </div>
        </motion.div>

        <CollapsibleContent>
          <div className="space-y-5 border-t px-6 py-6">
            {integration.lastValidationError ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {integration.lastValidationError}
                </AlertDescription>
              </Alert>
            ) : null}

            {sharedWarnings.length > 0 ? (
              <Alert>
                <AlertDescription>
                  <div className="space-y-1">
                    {sharedWarnings.map((warning) => (
                      <p key={`${warning.target}:${warning.code}`}>
                        {warning.message}
                      </p>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
              {capabilityChips.map((capability) => (
                <div
                  key={capability.label}
                  className="flex items-start gap-2.5 rounded-lg bg-muted/40 p-3 ring-1 ring-inset ring-border/60"
                >
                  <HugeiconsIcon
                    icon={capability.icon}
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-none">
                      {capability.label}
                    </p>
                    <p className="mt-1 text-xs text-pretty text-muted-foreground">
                      {capability.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Tabs defaultValue="overview" className="gap-5">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">Visão geral</TabsTrigger>
                <TabsTrigger value="sync">Sincronização</TabsTrigger>
                <TabsTrigger value="defaults">Padrões</TabsTrigger>
                <TabsTrigger value="activity">Atividade</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <ContaAzulOverviewTab
                  config={config}
                  disabled={disabled}
                  integration={integration}
                  mutations={native}
                  scheduleState={scheduleQuery}
                />
              </TabsContent>
              <TabsContent value="sync">
                <ContaAzulSyncTab
                  config={config}
                  integration={integration}
                  onConfigChange={(input) => native.config.mutate(input)}
                  schedule={connector.schedule}
                  sync={connector.sync}
                />
              </TabsContent>
              <TabsContent value="defaults">
                <ContaAzulDefaultsTab
                  catalogs={catalogs}
                  config={config}
                  disabled={disabled}
                  onConfigChange={(input) => native.config.mutate(input)}
                />
              </TabsContent>
              <TabsContent value="activity">
                <IntegrationActivity
                  integration={integration}
                  retry={connector.retry}
                />
              </TabsContent>
            </Tabs>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
