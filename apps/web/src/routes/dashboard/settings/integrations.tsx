import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { normalizeIntegrationBaseUrl } from '@calibra-facil/shared'
import { useActiveOrganization, useSession } from '@calibra-facil/auth/client'
import type {
  IntegrationFieldMappingRule,
  IntegrationMappedPreviewSample,
  IntegrationMappingFormatter,
  IntegrationMappingsConfig,
  IntegrationDependencyWarning,
  IntegrationReadinessSummary,
  IntegrationRunMode,
  IntegrationScheduleFrequency,
  IntegrationScheduleStatus,
  IntegrationTargetCoverageSummary,
  IntegrationTargetSyncSummary,
} from '@calibra-facil/shared'
import { getDefaultIntegrationMappings, INTEGRATION_CANONICAL_FIELDS } from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/dashboard/settings/integrations')({
  head: () => ({
    meta: [{ title: 'Integrações | Configurações | CalibraFácil' }],
  }),
  component: IntegrationsSettingsPage,
})

type SyncTarget = 'customer' | 'service_order' | 'billing_document'

interface IntegrationConfig {
  baseUrl: string
  healthPath: string
  customerPath: string
  serviceOrderPath: string
  billingDocumentPath: string
  authType: 'bearer'
  mappings: IntegrationMappingsConfig
}

interface IntegrationRun {
  id: string
  target: SyncTarget
  trigger: 'manual' | 'event' | 'scheduled' | 'retry'
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL'
  processedCount: number
  successCount: number
  errorCount: number
  errorSummary: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  summary?: {
    requestedLimit?: number
    blocked?: boolean
    retryOfRunId?: string | null
  } | null
}

interface IntegrationEvent {
  id: number
  level: 'info' | 'warning' | 'error'
  event: string
  message: string
  createdAt: string
}

interface IntegrationOverview {
  readiness: IntegrationReadinessSummary
  targets: IntegrationTargetSyncSummary[]
  syncSummary: {
    lastRunAt: string | null
    lastSuccessfulRunAt: string | null
    lastErrorAt: string | null
    hasRecentFailures: boolean
  }
}

interface IntegrationSummary {
  id: string
  type: 'financial_erp'
  provider: 'generic_http'
  name: string
  status: 'ACTIVE' | 'DISABLED'
  lastValidatedAt: string | null
  lastValidationError: string | null
  createdAt: string
  updatedAt: string
  connection: {
    id: string | null
    credentialType: 'bearer'
    config: IntegrationConfig | null
  }
  recentRuns: IntegrationRun[]
  recentEvents: IntegrationEvent[]
  overview: IntegrationOverview
}

interface IntegrationsResponse {
  billing: {
    planId: string
    planName: string
    status: string
    hasCustomIntegrations: boolean
  }
  data: IntegrationSummary[]
}

interface SyncPreviewResponse {
  target: SyncTarget
  requestedLimit: number
  blocked: boolean
  warnings: IntegrationDependencyWarning[]
  coverage: IntegrationTargetCoverageSummary
  previewCount: number
  sampleRecords: IntegrationMappedPreviewSample[]
}

const defaultDraft = {
  name: 'ERP Financeiro',
  baseUrl: '',
  authToken: '',
  healthPath: '/health',
  customerPath: '/customers',
  serviceOrderPath: '/service-orders',
  billingDocumentPath: '/billing-documents',
}

const targetMeta: Record<
  SyncTarget,
  {
    label: string
    description: string
    syncLabel: string
  }
> = {
  customer: {
    label: 'Clientes',
    description: 'Base mínima para liberar ordens e faturamento.',
    syncLabel: 'Sincronizar clientes',
  },
  service_order: {
    label: 'Ordens de serviço',
    description: 'Depende de clientes vinculados remotamente.',
    syncLabel: 'Sincronizar ordens',
  },
  billing_document: {
    label: 'Documentos financeiros',
    description: 'Depende de clientes e ordens já resolvidos no ERP.',
    syncLabel: 'Sincronizar faturamento',
  },
}

const formatterOptions: Array<{
  value: IntegrationMappingFormatter
  label: string
}> = [
  { value: 'none', label: 'Sem formatação' },
  { value: 'string', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'boolean', label: 'Booleano' },
  { value: 'upper_case', label: 'Maiúsculas' },
  { value: 'lower_case', label: 'Minúsculas' },
  { value: 'digits_only', label: 'Somente dígitos' },
  { value: 'date_only', label: 'Data' },
  { value: 'iso_datetime', label: 'Data e hora ISO' },
  { value: 'currency_major', label: 'Moeda em unidade' },
]

function cloneMappings(mappings: IntegrationMappingsConfig): IntegrationMappingsConfig {
  return {
    customer: {
      fields: mappings.customer.fields.map((field) => ({ ...field })),
    },
    service_order: {
      fields: mappings.service_order.fields.map((field) => ({ ...field })),
    },
    billing_document: {
      fields: mappings.billing_document.fields.map((field) => ({ ...field })),
    },
  }
}

function createEmptyMappingRule(target: SyncTarget): IntegrationFieldMappingRule {
  return {
    id: crypto.randomUUID(),
    destinationField: '',
    enabled: true,
    valueMode: 'source',
    sourceField: INTEGRATION_CANONICAL_FIELDS[target][0] ?? null,
    constantValue: null,
    formatter: 'none',
  }
}

function formatPreviewPayload(payload: Record<string, unknown>) {
  return JSON.stringify(payload, null, 2)
}

function formatDateTime(value: string | null) {
  if (!value) return 'Ainda não disponível'

  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatDuration(value: number | null | undefined) {
  if (!value || value <= 0) return 'Sem duração'
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${Math.round(value / 100) / 10}s`
  return `${Math.round(value / 6000) / 10} min`
}

function readinessBadgeVariant(
  status: IntegrationReadinessSummary['readinessStatus'],
) {
  switch (status) {
    case 'READY':
      return 'default'
    case 'DEGRADED':
      return 'secondary'
    default:
      return 'destructive'
  }
}

function coveragePercentage(coverage: IntegrationTargetCoverageSummary) {
  if (coverage.localCount === 0) return 0
  return Math.round((coverage.linkedCount / coverage.localCount) * 100)
}

function scheduleStatusVariant(status: IntegrationScheduleStatus) {
  switch (status) {
    case 'scheduled':
    case 'manual_only':
    case 'disabled':
      return 'outline'
    case 'due':
      return 'secondary'
    case 'running':
      return 'default'
    case 'blocked':
    case 'failing':
      return 'destructive'
  }
}

function scheduleStatusLabel(status: IntegrationScheduleStatus) {
  switch (status) {
    case 'disabled':
      return 'Desligado'
    case 'manual_only':
      return 'Manual'
    case 'scheduled':
      return 'Agendado'
    case 'due':
      return 'Vencido'
    case 'running':
      return 'Executando'
    case 'blocked':
      return 'Bloqueado'
    case 'failing':
      return 'Falhando'
  }
}

function runTriggerLabel(trigger: IntegrationRun['trigger']) {
  switch (trigger) {
    case 'scheduled':
      return 'Agendado'
    case 'retry':
      return 'Reprocessado'
    case 'event':
      return 'Evento'
    default:
      return 'Manual'
  }
}

function fallbackTargetSummary(target: SyncTarget): IntegrationTargetSyncSummary {
  return {
    target,
    lastRunAt: null,
    lastSuccessfulRunAt: null,
    lastStatus: null,
    lastTrigger: null,
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    blocked: true,
    warnings: [],
    coverage: {
      target,
      localCount: 0,
      linkedCount: 0,
      unlinkedCount: 0,
    },
    schedule: {
      target,
      mode: 'manual_only',
      frequency: 'daily',
      status: 'manual_only',
      nextScheduledRunAt: null,
      lastScheduledRunAt: null,
    },
    lastRunDurationMs: null,
    consecutiveFailures: 0,
    lastBlockedAt: null,
    hasActiveRun: false,
  }
}

function getTargetSummary(
  integration: IntegrationSummary,
  target: SyncTarget,
) {
  return (
    integration.overview.targets.find((item) => item.target === target) ??
    fallbackTargetSummary(target)
  )
}

function buildChecklist(integration: IntegrationSummary) {
  const customerTarget = getTargetSummary(integration, 'customer')
  const serviceOrderTarget = getTargetSummary(integration, 'service_order')
  const billingTarget = getTargetSummary(integration, 'billing_document')

  return [
    {
      label: 'Endpoint configurado',
      done: Boolean(integration.connection.config?.baseUrl),
      help: integration.connection.config?.baseUrl ?? 'Informe a Base URL do conector.',
    },
    {
      label: 'Conexão validada',
      done:
        Boolean(integration.lastValidatedAt) && !integration.lastValidationError,
      help: integration.lastValidationError
        ? integration.lastValidationError
        : integration.lastValidatedAt
          ? `Validada em ${formatDateTime(integration.lastValidatedAt)}`
          : 'Execute a validação do health endpoint.',
    },
    {
      label: 'Clientes com vínculo remoto',
      done:
        customerTarget.coverage.localCount === 0 ||
        customerTarget.coverage.unlinkedCount === 0,
      help: `${customerTarget.coverage.linkedCount}/${customerTarget.coverage.localCount} clientes vinculados.`,
    },
    {
      label: 'Ordens liberadas para sync',
      done: !serviceOrderTarget.blocked,
      help:
        serviceOrderTarget.warnings[0]?.message ??
        'Ordens podem ser sincronizadas.',
    },
    {
      label: 'Faturamento liberado',
      done: !billingTarget.blocked,
      help:
        billingTarget.warnings[0]?.message ??
        'Documentos financeiros podem ser enviados.',
    },
  ]
}

function validateBaseUrl(baseUrl: string) {
  if (!baseUrl.trim()) return null

  try {
    normalizeIntegrationBaseUrl(baseUrl)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Base URL inválida'
  }
}

function IntegrationsSettingsPage() {
  const queryClient = useQueryClient()
  const { data: session, isPending: isLoadingSession } = useSession()
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()
  const currentUserId = session?.user?.id
  const currentMember = activeOrg?.members?.find((member) => {
    const candidate = member as {
      userId?: string
      user?: { id?: string }
      role?: string
    }
    return (
      candidate.userId === currentUserId ||
      candidate.user?.id === currentUserId
    )
  })
  const currentOrgRole =
    typeof currentMember?.role === 'string' ? currentMember.role : 'member'
  const canManage = currentOrgRole === 'owner' || currentOrgRole === 'admin'
  const [draft, setDraft] = useState(defaultDraft)
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)
  const [previewByKey, setPreviewByKey] = useState<
    Record<string, SyncPreviewResponse>
  >({})
  const [mappingDrafts, setMappingDrafts] = useState<
    Record<string, IntegrationMappingsConfig>
  >({})

  const integrationsQuery = useQuery({
    queryKey: ['integrations'],
    queryFn: () => calibraApi.integrations.list<IntegrationsResponse>(),
    enabled: canManage,
  })

  const refreshIntegrations = async () => {
    await queryClient.invalidateQueries({ queryKey: ['integrations'] })
  }

  const getMappingDraft = (integration: IntegrationSummary) =>
    mappingDrafts[integration.id] ??
    cloneMappings(
      integration.connection.config?.mappings ?? getDefaultIntegrationMappings(),
    )

  const updateMappingDraft = (
    integration: IntegrationSummary,
    updater: (current: IntegrationMappingsConfig) => IntegrationMappingsConfig,
  ) => {
    setMappingDrafts((current) => {
      const base = current[integration.id] ?? getMappingDraft(integration)

      return {
        ...current,
        [integration.id]: updater(cloneMappings(base)),
      }
    })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.integrations.create(draft)
    },
    onSuccess: async () => {
      toast.success('Integração criada')
      setDraft(defaultDraft)
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar integração',
      )
    },
  })

  const validateMutation = useMutation({
    mutationFn: async (id: string) => {
      return calibraApi.integrations.validate(id)
    },
    onSuccess: async () => {
      toast.success('Conector validado')
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar conexão',
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      mappings,
    }: {
      id: string
      mappings: IntegrationMappingsConfig
    }) => {
      return calibraApi.integrations.update(id, { mappings })
    },
    onSuccess: async (_data, variables) => {
      toast.success('Mapeamento salvo')
      setMappingDrafts((current) => {
        const next = { ...current }
        delete next[variables.id]
        return next
      })
      setPreviewByKey((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !key.startsWith(`${variables.id}:`)),
        ),
      )
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar mapeamento',
      )
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({
      id,
      enabled,
    }: {
      id: string
      enabled: boolean
    }) => {
      return calibraApi.integrations.toggle(id, { enabled })
    },
    onSuccess: async () => {
      toast.success('Status da integração atualizado')
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar status',
      )
    },
  })

  const previewMutation = useMutation({
    mutationFn: async ({
      id,
      target,
      mappings,
    }: {
      id: string
      target: SyncTarget
      mappings?: IntegrationMappingsConfig
    }) => {
      return calibraApi.integrations.previewSync<SyncPreviewResponse>(id, {
        target,
        limit: 50,
        mappings,
      })
    },
    onSuccess: (data, variables) => {
      setPreviewByKey((current) => ({
        ...current,
        [`${variables.id}:${variables.target}`]: data,
      }))
      toast.success(`Prévia pronta para ${targetMeta[variables.target].label}`)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao montar prévia',
      )
    },
  })

  const syncMutation = useMutation({
    mutationFn: async ({
      id,
      target,
    }: {
      id: string
      target: SyncTarget
    }) => {
      return calibraApi.integrations.sync(id, { target, limit: 50 })
    },
    onSuccess: async (data, variables) => {
      toast.success(
        data && typeof data === 'object' && 'queued' in data && data.queued
          ? `${targetMeta[variables.target].label} enfileirados`
          : `${targetMeta[variables.target].label} sincronizados`,
      )
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao iniciar sync',
      )
    },
  })

  const scheduleMutation = useMutation({
    mutationFn: async ({
      id,
      target,
      mode,
      frequency,
    }: {
      id: string
      target: SyncTarget
      mode: IntegrationRunMode
      frequency?: IntegrationScheduleFrequency
    }) => {
      return calibraApi.integrations.schedule(id, { target, mode, frequency })
    },
    onSuccess: async () => {
      toast.success('Agendamento atualizado')
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar agenda',
      )
    },
  })

  const retryMutation = useMutation({
    mutationFn: async ({
      id,
      runId,
    }: {
      id: string
      runId: string
    }) => {
      return calibraApi.integrations.retryRun(id, runId)
    },
    onSuccess: async () => {
      toast.success('Reprocessamento disparado')
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao reprocessar sync',
      )
    },
  })

  if (isLoadingOrg || isLoadingSession) {
    return <IntegrationsSkeleton />
  }

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrações Enterprise</CardTitle>
          <CardDescription>
            Apenas administradores globais podem gerenciar integrações.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (integrationsQuery.isLoading) {
    return <IntegrationsSkeleton />
  }

  if (integrationsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrações Enterprise</CardTitle>
          <CardDescription>
            {integrationsQuery.error instanceof Error
              ? integrationsQuery.error.message
              : 'Falha ao carregar integrações'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!integrationsQuery.data) {
    return <IntegrationsSkeleton />
  }

  const payload = integrationsQuery.data
  const hasEntitlement = payload.billing.hasCustomIntegrations
  const activeSummaries = {
    total: payload.data.length,
    atRisk: payload.data.filter(
      (integration) => integration.overview.readiness.readinessStatus !== 'READY',
    ).length,
    scheduledTargets: payload.data.flatMap((integration) => integration.overview.targets)
      .filter((target) => target.schedule.mode === 'scheduled').length,
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conector ERP financeiro</CardTitle>
          <CardDescription>
            Workspace de rollout para validar conexão, medir prontidão e
            sincronizar clientes, ordens de serviço e documentos financeiros.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={hasEntitlement ? 'default' : 'secondary'}>
              {hasEntitlement
                ? `${payload.billing.planName} ativo`
                : 'Disponível apenas no Enterprise'}
            </Badge>
            <Badge variant="outline">Provider: Generic HTTP</Badge>
            <Badge variant="outline">Tipo: ERP financeiro</Badge>
            <Badge variant="outline">
              {activeSummaries.total} conector
              {activeSummaries.total === 1 ? '' : 'es'}
            </Badge>
            <Badge variant="outline">
              {activeSummaries.atRisk} em atenção
            </Badge>
            <Badge variant="outline">
              {activeSummaries.scheduledTargets} alvo
              {activeSummaries.scheduledTargets === 1 ? '' : 's'} agendado
              {activeSummaries.scheduledTargets === 1 ? '' : 's'}
            </Badge>
          </div>

          {!hasEntitlement && (
            <Alert>
              <AlertDescription>
                O entitlement <code>custom_integrations</code> está disponível
                apenas no plano Enterprise. Você ainda pode inspecionar
                conectores existentes, mas não criar nem sincronizar novos.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Novo conector</CardTitle>
          <CardDescription>
            Configure o endpoint HTTP do ERP que receberá os payloads
            normalizados do CalibraFácil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Nome</FieldLabel>
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((current) => ({ ...current, name: e.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel>Base URL</FieldLabel>
              <Input
                placeholder="https://erp.exemplo.com/api/calibrafacil"
                value={draft.baseUrl}
                onBlur={() => setBaseUrlError(validateBaseUrl(draft.baseUrl))}
                onChange={(e) => {
                  const nextValue = e.target.value
                  setDraft((current) => ({
                    ...current,
                    baseUrl: nextValue,
                  }))
                  setBaseUrlError(validateBaseUrl(nextValue))
                }}
              />
              <FieldDescription>
                Endpoint base do middleware HTTP do ERP.
              </FieldDescription>
              <FieldError>{baseUrlError}</FieldError>
            </Field>
            <Field>
              <FieldLabel>Token Bearer</FieldLabel>
              <Input
                type="password"
                value={draft.authToken}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    authToken: e.target.value,
                  }))
                }
              />
            </Field>
            <Field>
              <FieldLabel>Health Path</FieldLabel>
              <Input
                value={draft.healthPath}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    healthPath: e.target.value,
                  }))
                }
              />
            </Field>
            <Field>
              <FieldLabel>Customers Path</FieldLabel>
              <Input
                value={draft.customerPath}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    customerPath: e.target.value,
                  }))
                }
              />
            </Field>
            <Field>
              <FieldLabel>Service Orders Path</FieldLabel>
              <Input
                value={draft.serviceOrderPath}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    serviceOrderPath: e.target.value,
                  }))
                }
              />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Billing Documents Path</FieldLabel>
              <Input
                value={draft.billingDocumentPath}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    billingDocumentPath: e.target.value,
                  }))
                }
              />
            </Field>
          </FieldGroup>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !hasEntitlement ||
                createMutation.isPending ||
                !draft.baseUrl ||
                !draft.authToken ||
                !!baseUrlError
              }
            >
              {createMutation.isPending ? 'Criando...' : 'Criar conector'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {payload.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum conector configurado</CardTitle>
            <CardDescription>
              Crie sua primeira integração enterprise para abrir o rollout por
              clientes, ordens e faturamento.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        payload.data.map((integration) => {
          const checklist = buildChecklist(integration)
          const dependencyWarnings =
            integration.overview.readiness.dependencyWarnings
          const draftMappings = getMappingDraft(integration)

          return (
            <Card key={integration.id}>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{integration.name}</CardTitle>
                    <CardDescription>
                      {integration.connection.config?.baseUrl ?? 'Sem conexão'}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        integration.status === 'ACTIVE' ? 'default' : 'secondary'
                      }
                    >
                      {integration.status === 'ACTIVE' ? 'Ativa' : 'Desativada'}
                    </Badge>
                    <Badge
                      variant={readinessBadgeVariant(
                        integration.overview.readiness.readinessStatus,
                      )}
                    >
                      {integration.overview.readiness.readinessStatus === 'READY'
                        ? 'Pronta'
                        : integration.overview.readiness.readinessStatus ===
                            'DEGRADED'
                          ? 'Com dependências'
                          : 'Não pronta'}
                    </Badge>
                    <Badge variant="outline">
                      {integration.overview.readiness.setupStatus}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard
                    label="Última validação"
                    value={formatDateTime(
                      integration.overview.readiness.lastValidatedAt,
                    )}
                  />
                  <MetricCard
                    label="Último sync"
                    value={formatDateTime(
                      integration.overview.syncSummary.lastRunAt,
                    )}
                  />
                  <MetricCard
                    label="Último sucesso"
                    value={formatDateTime(
                      integration.overview.syncSummary.lastSuccessfulRunAt,
                    )}
                  />
                  <MetricCard
                    label="Último erro"
                    value={formatDateTime(
                      integration.overview.syncSummary.lastErrorAt,
                    )}
                  />
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {integration.lastValidationError && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {integration.lastValidationError}
                    </AlertDescription>
                  </Alert>
                )}

                {dependencyWarnings.length > 0 && (
                  <Alert>
                    <AlertDescription>
                      <div className="space-y-1">
                        {dependencyWarnings.map((warning) => (
                          <p key={`${warning.target}:${warning.code}`}>
                            {targetMeta[warning.target].label}: {warning.message}
                          </p>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => validateMutation.mutate(integration.id)}
                    disabled={!hasEntitlement || validateMutation.isPending}
                  >
                    {validateMutation.isPending ? 'Validando...' : 'Validar conexão'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      toggleMutation.mutate({
                        id: integration.id,
                        enabled: integration.status !== 'ACTIVE',
                      })
                    }
                    disabled={!hasEntitlement || toggleMutation.isPending}
                  >
                    {integration.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>

                <div className="grid gap-6 xl:grid-cols-[1.15fr_2fr]">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Readiness</CardTitle>
                      <CardDescription>
                        Checklist de rollout do conector antes de colocá-lo em
                        produção.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {checklist.map((item) => (
                        <div
                          key={item.label}
                          className="rounded-md border p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{item.label}</span>
                            <Badge variant={item.done ? 'default' : 'secondary'}>
                              {item.done ? 'OK' : 'Pendente'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            {item.help}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 lg:grid-cols-3">
                    {(['customer', 'service_order', 'billing_document'] as const).map(
                      (target) => {
                        const summary = getTargetSummary(integration, target)
                        const preview =
                          previewByKey[`${integration.id}:${target}`] ?? null
                        const targetMappings = draftMappings[target]

                        return (
                          <Card key={target}>
                            <CardHeader>
                              <CardTitle className="text-base">
                                {targetMeta[target].label}
                              </CardTitle>
                              <CardDescription>
                                {targetMeta[target].description}
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span>Cobertura remota</span>
                                  <span>
                                    {summary.coverage.linkedCount}/
                                    {summary.coverage.localCount}
                                  </span>
                                </div>
                                <Progress
                                  value={coveragePercentage(summary.coverage)}
                                  className="h-2"
                                />
                                <p className="text-xs text-muted-foreground">
                                  {summary.coverage.unlinkedCount} registros sem
                                  vínculo remoto.
                                </p>
                              </div>

                              <div className="grid gap-2 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-muted-foreground">
                                    Último status
                                  </span>
                                  <Badge variant="outline">
                                    {summary.lastStatus ?? 'Sem execução'}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-muted-foreground">
                                    Trigger
                                  </span>
                                  <span>
                                    {summary.lastTrigger
                                      ? runTriggerLabel(summary.lastTrigger)
                                      : 'Sem execução'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-muted-foreground">
                                    Último sucesso
                                  </span>
                                  <span>
                                    {formatDateTime(summary.lastSuccessfulRunAt)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-muted-foreground">
                                    Última execução
                                  </span>
                                  <span>{formatDateTime(summary.lastRunAt)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-muted-foreground">
                                    Duração
                                  </span>
                                  <span>
                                    {formatDuration(summary.lastRunDurationMs)}
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-md border p-3 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">Agendamento</span>
                                  <Badge
                                    variant={scheduleStatusVariant(
                                      summary.schedule.status,
                                    )}
                                  >
                                    {scheduleStatusLabel(summary.schedule.status)}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-2 text-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">
                                      Modo
                                    </span>
                                    <span>
                                      {summary.schedule.mode === 'scheduled'
                                        ? 'Automático'
                                        : summary.schedule.mode === 'disabled'
                                          ? 'Desligado'
                                          : 'Manual'}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">
                                      Frequência
                                    </span>
                                    <span>
                                      {summary.schedule.frequency === 'weekly'
                                        ? 'Semanal'
                                        : 'Diária'}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">
                                      Próxima execução
                                    </span>
                                    <span>
                                      {formatDateTime(
                                        summary.schedule.nextScheduledRunAt,
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">
                                      Último schedule
                                    </span>
                                    <span>
                                      {formatDateTime(
                                        summary.schedule.lastScheduledRunAt,
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">
                                      Falhas consecutivas
                                    </span>
                                    <span>{summary.consecutiveFailures}</span>
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    variant={
                                      summary.schedule.mode === 'manual_only'
                                        ? 'default'
                                        : 'outline'
                                    }
                                    onClick={() =>
                                      scheduleMutation.mutate({
                                        id: integration.id,
                                        target,
                                        mode: 'manual_only',
                                      })
                                    }
                                    disabled={
                                      !hasEntitlement ||
                                      scheduleMutation.isPending
                                    }
                                  >
                                    Manual
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={
                                      summary.schedule.mode === 'scheduled'
                                      && summary.schedule.frequency === 'daily'
                                        ? 'default'
                                        : 'outline'
                                    }
                                    onClick={() =>
                                      scheduleMutation.mutate({
                                        id: integration.id,
                                        target,
                                        mode: 'scheduled',
                                        frequency: 'daily',
                                      })
                                    }
                                    disabled={
                                      !hasEntitlement ||
                                      scheduleMutation.isPending
                                    }
                                  >
                                    Diário
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={
                                      summary.schedule.mode === 'scheduled'
                                      && summary.schedule.frequency === 'weekly'
                                        ? 'default'
                                        : 'outline'
                                    }
                                    onClick={() =>
                                      scheduleMutation.mutate({
                                        id: integration.id,
                                        target,
                                        mode: 'scheduled',
                                        frequency: 'weekly',
                                      })
                                    }
                                    disabled={
                                      !hasEntitlement ||
                                      scheduleMutation.isPending
                                    }
                                  >
                                    Semanal
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={
                                      summary.schedule.mode === 'disabled'
                                        ? 'destructive'
                                        : 'outline'
                                    }
                                    onClick={() =>
                                      scheduleMutation.mutate({
                                        id: integration.id,
                                        target,
                                        mode: 'disabled',
                                      })
                                    }
                                    disabled={
                                      !hasEntitlement ||
                                      scheduleMutation.isPending
                                    }
                                  >
                                    Desligar
                                  </Button>
                                </div>
                              </div>

                              {summary.warnings.length > 0 && (
                                <div className="space-y-2">
                                  {summary.warnings.map((warning) => (
                                    <Alert
                                      key={`${warning.target}:${warning.code}`}
                                      variant={
                                        warning.severity === 'error'
                                          ? 'destructive'
                                          : 'default'
                                      }
                                    >
                                      <AlertDescription>
                                        {warning.message}
                                      </AlertDescription>
                                    </Alert>
                                  ))}
                                </div>
                              )}

                              <div className="space-y-3 rounded-md border p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <p className="font-medium">Mapeamento</p>
                                    <p className="text-xs text-muted-foreground">
                                      Ajuste o payload enviado ao ERP para este alvo.
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      updateMappingDraft(integration, (current) => ({
                                        ...current,
                                        [target]: {
                                          fields: [
                                            ...current[target].fields,
                                            createEmptyMappingRule(target),
                                          ],
                                        },
                                      }))
                                    }
                                  >
                                    Adicionar campo
                                  </Button>
                                </div>

                                <div className="space-y-3">
                                  {targetMappings.fields.map((field) => (
                                    <div
                                      key={field.id}
                                      className="rounded-md border bg-muted/20 p-3"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <Checkbox
                                            checked={field.enabled}
                                            onCheckedChange={(checked) =>
                                              updateMappingDraft(integration, (current) => ({
                                                ...current,
                                                [target]: {
                                                  fields: current[target].fields.map((item) =>
                                                    item.id === field.id
                                                      ? {
                                                          ...item,
                                                          enabled: checked === true,
                                                        }
                                                      : item,
                                                  ),
                                                },
                                              }))
                                            }
                                          />
                                          <span className="text-sm font-medium">
                                            {field.destinationField || 'Novo campo'}
                                          </span>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            updateMappingDraft(integration, (current) => ({
                                              ...current,
                                              [target]: {
                                                fields: current[target].fields.filter(
                                                  (item) => item.id !== field.id,
                                                ),
                                              },
                                            }))
                                          }
                                        >
                                          Remover
                                        </Button>
                                      </div>

                                      <div className="mt-3 grid gap-3">
                                        <Field>
                                          <FieldLabel>Destino</FieldLabel>
                                          <Input
                                            value={field.destinationField}
                                            onChange={(e) =>
                                              updateMappingDraft(integration, (current) => ({
                                                ...current,
                                                [target]: {
                                                  fields: current[target].fields.map((item) =>
                                                    item.id === field.id
                                                      ? {
                                                          ...item,
                                                          destinationField: e.target.value,
                                                        }
                                                      : item,
                                                  ),
                                                },
                                              }))
                                            }
                                            placeholder="ex: externalCode"
                                          />
                                        </Field>

                                        <div className="grid gap-3 md:grid-cols-3">
                                          <Field>
                                            <FieldLabel>Origem</FieldLabel>
                                            <Select
                                              value={field.valueMode}
                                              onValueChange={(value) =>
                                                updateMappingDraft(integration, (current) => ({
                                                  ...current,
                                                  [target]: {
                                                    fields: current[target].fields.map((item) =>
                                                      item.id === field.id
                                                        ? {
                                                            ...item,
                                                            valueMode:
                                                              value === 'constant'
                                                                ? 'constant'
                                                                : 'source',
                                                          }
                                                        : item,
                                                    ),
                                                  },
                                                }))
                                              }
                                            >
                                              <SelectTrigger>
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="source">Campo do CalibraFácil</SelectItem>
                                                <SelectItem value="constant">Valor constante</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </Field>

                                          {field.valueMode === 'source' ? (
                                            <Field>
                                              <FieldLabel>Campo fonte</FieldLabel>
                                              <Select
                                                value={field.sourceField ?? ''}
                                                onValueChange={(value) =>
                                                  updateMappingDraft(integration, (current) => ({
                                                    ...current,
                                                    [target]: {
                                                      fields: current[target].fields.map((item) =>
                                                        item.id === field.id
                                                          ? {
                                                              ...item,
                                                              sourceField: value,
                                                            }
                                                          : item,
                                                      ),
                                                    },
                                                  }))
                                                }
                                              >
                                                <SelectTrigger>
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {INTEGRATION_CANONICAL_FIELDS[target].map((sourceField) => (
                                                    <SelectItem
                                                      key={sourceField}
                                                      value={sourceField}
                                                    >
                                                      {sourceField}
                                                    </SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                            </Field>
                                          ) : (
                                            <Field>
                                              <FieldLabel>Valor constante</FieldLabel>
                                              <Input
                                                value={field.constantValue ?? ''}
                                                onChange={(e) =>
                                                  updateMappingDraft(integration, (current) => ({
                                                    ...current,
                                                    [target]: {
                                                      fields: current[target].fields.map((item) =>
                                                        item.id === field.id
                                                          ? {
                                                              ...item,
                                                              constantValue: e.target.value,
                                                            }
                                                          : item,
                                                      ),
                                                    },
                                                  }))
                                                }
                                                placeholder="ex: BRL"
                                              />
                                            </Field>
                                          )}

                                          <Field>
                                            <FieldLabel>Formato</FieldLabel>
                                            <Select
                                              value={field.formatter}
                                              onValueChange={(value) =>
                                                updateMappingDraft(integration, (current) => ({
                                                  ...current,
                                                  [target]: {
                                                    fields: current[target].fields.map((item) =>
                                                      item.id === field.id
                                                        ? {
                                                            ...item,
                                                            formatter:
                                                              value as IntegrationMappingFormatter,
                                                          }
                                                        : item,
                                                    ),
                                                  },
                                                }))
                                              }
                                            >
                                              <SelectTrigger>
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {formatterOptions.map((option) => (
                                                  <SelectItem
                                                    key={option.value}
                                                    value={option.value}
                                                  >
                                                    {option.label}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </Field>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      previewMutation.mutate({
                                        id: integration.id,
                                        target,
                                        mappings: draftMappings,
                                      })
                                    }
                                    disabled={
                                      !hasEntitlement || previewMutation.isPending
                                    }
                                  >
                                    {previewMutation.isPending
                                      ? 'Validando...'
                                      : 'Prévia do mapeamento'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      updateMutation.mutate({
                                        id: integration.id,
                                        mappings: draftMappings,
                                      })
                                    }
                                    disabled={
                                      !hasEntitlement || updateMutation.isPending
                                    }
                                  >
                                    {updateMutation.isPending
                                      ? 'Salvando...'
                                      : 'Salvar mapeamento'}
                                  </Button>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    syncMutation.mutate({
                                      id: integration.id,
                                      target,
                                    })
                                  }
                                  disabled={
                                    !hasEntitlement ||
                                    syncMutation.isPending ||
                                    summary.blocked
                                  }
                                >
                                  {syncMutation.isPending
                                    ? 'Sincronizando...'
                                    : targetMeta[target].syncLabel}
                                </Button>
                              </div>

                              {summary.lastBlockedAt && (
                                <p className="text-xs text-muted-foreground">
                                  Último bloqueio detectado em{' '}
                                  {formatDateTime(summary.lastBlockedAt)}.
                                </p>
                              )}

                              {preview && (
                                <>
                                  <Separator />
                                  <div className="space-y-3 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-medium">Prévia</span>
                                      <Badge
                                        variant={
                                          preview.blocked
                                            ? 'destructive'
                                            : 'secondary'
                                        }
                                      >
                                        {preview.blocked ? 'Bloqueada' : 'Pronta'}
                                      </Badge>
                                    </div>
                                    <p className="text-muted-foreground">
                                      {preview.previewCount} registros avaliados
                                      nesta prévia.
                                    </p>
                                    {preview.sampleRecords.length > 0 ? (
                                      <div className="space-y-2">
                                        {preview.sampleRecords.map((record) => (
                                          <div
                                            key={record.externalId}
                                            className="rounded-md border p-2"
                                          >
                                            <p className="font-medium">
                                              {record.label}
                                            </p>
                                            <p className="text-muted-foreground">
                                              {record.subtitle ??
                                                record.externalId}
                                            </p>
                                            {record.issues.length > 0 ? (
                                              <div className="mt-2 space-y-1">
                                                {record.issues.map((issue) => (
                                                  <p
                                                    key={`${record.externalId}:${issue}`}
                                                    className="text-xs text-destructive"
                                                  >
                                                    {issue}
                                                  </p>
                                                ))}
                                              </div>
                                            ) : null}
                                            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                                              {formatPreviewPayload(record.mappedPayload)}
                                            </pre>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-muted-foreground">
                                        Nenhum registro candidato neste momento.
                                      </p>
                                    )}
                                  </div>
                                </>
                              )}
                            </CardContent>
                          </Card>
                        )
                      },
                    )}
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Execuções recentes</CardTitle>
                      <CardDescription>
                        Histórico operacional das últimas sincronizações.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {integration.recentRuns.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhuma execução registrada.
                        </p>
                      ) : (
                        integration.recentRuns.map((run) => (
                          <div
                            key={run.id}
                            className="rounded-md border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {targetMeta[run.target].label}
                                </span>
                                <Badge variant="outline">
                                  {runTriggerLabel(run.trigger)}
                                </Badge>
                                <Badge variant="outline">{run.status}</Badge>
                              </div>
                              {run.status !== 'PENDING' &&
                              run.status !== 'RUNNING' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    retryMutation.mutate({
                                      id: integration.id,
                                      runId: run.id,
                                    })
                                  }
                                  disabled={
                                    !hasEntitlement || retryMutation.isPending
                                  }
                                >
                                  {retryMutation.isPending
                                    ? 'Reprocessando...'
                                    : 'Reprocessar'}
                                </Button>
                              ) : null}
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {run.successCount}/{run.processedCount} itens com
                              sucesso em {formatDateTime(run.createdAt)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Limite: {run.summary?.requestedLimit ?? 50}
                              {run.summary?.blocked ? ' · bloqueado por dependência' : ''}
                              {run.summary?.retryOfRunId
                                ? ` · retry de ${run.summary.retryOfRunId}`
                                : ''}
                            </p>
                            {run.errorSummary && (
                              <p className="mt-1 text-destructive">
                                {run.errorSummary}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Eventos recentes</CardTitle>
                      <CardDescription>
                        Erros, validações e checkpoints recentes do conector.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {integration.recentEvents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhum evento registrado.
                        </p>
                      ) : (
                        integration.recentEvents.map((event) => (
                          <div
                            key={event.id}
                            className="rounded-md border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{event.event}</span>
                              <Badge
                                variant={
                                  event.level === 'error'
                                    ? 'destructive'
                                    : event.level === 'warning'
                                      ? 'secondary'
                                      : 'outline'
                                }
                              >
                                {event.level}
                              </Badge>
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {event.message}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDateTime(event.createdAt)}
                            </p>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  )
}

function IntegrationsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-[640px] w-full" />
    </div>
  )
}
