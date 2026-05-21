import {
  INTEGRATION_CANONICAL_FIELDS,
  getDefaultIntegrationMappings,
  normalizeIntegrationBaseUrl,
  type IntegrationFieldMappingRule,
  type IntegrationMappingFormatter,
  type IntegrationMappingsConfig,
  type IntegrationReadinessSummary,
  type IntegrationScheduleStatus,
  type IntegrationTargetCoverageSummary,
  type IntegrationTargetSyncSummary,
} from '@calibra-facil/shared'

import type {
  IntegrationRun,
  IntegrationSummary,
  SyncTarget,
} from '@/features/settings/types'

export const defaultIntegrationDraft = {
  name: 'ERP Financeiro',
  baseUrl: '',
  authToken: '',
  healthPath: '/health',
  customerPath: '/customers',
  serviceOrderPath: '/service-orders',
  billingDocumentPath: '/billing-documents',
}

export type IntegrationConfigDraft = typeof defaultIntegrationDraft

export type IntegrationMappingDrafts = Record<string, IntegrationMappingsConfig>

export type IntegrationMemberSource = {
  userId?: string
  user?: { id?: string }
  role?: string
}

export const integrationTargetMeta: Record<
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

export function getIntegrationSettingsRole(
  currentUserId: string | undefined,
  members: readonly IntegrationMemberSource[] | undefined,
) {
  const currentMember = members?.find(
    (member) =>
      member.userId === currentUserId || member.user?.id === currentUserId,
  )

  return typeof currentMember?.role === 'string' ? currentMember.role : 'member'
}

export function canManageIntegrationSettings(role: string) {
  return role === 'owner' || role === 'admin'
}

export function buildIntegrationActiveSummaries(
  integrations: readonly IntegrationSummary[],
) {
  return {
    total: integrations.length,
    atRisk: integrations.filter(
      (integration) =>
        integration.overview.readiness.readinessStatus !== 'READY',
    ).length,
    scheduledTargets: integrations
      .flatMap((integration) => integration.overview.targets)
      .filter((target) => target.schedule.mode === 'scheduled').length,
  }
}

export const integrationFormatterOptions: Array<{
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

export function cloneIntegrationMappings(
  mappings: IntegrationMappingsConfig,
): IntegrationMappingsConfig {
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

export function getIntegrationMappingDraft({
  drafts,
  integration,
}: {
  drafts: IntegrationMappingDrafts
  integration: IntegrationSummary
}) {
  return (
    drafts[integration.id] ??
    cloneIntegrationMappings(
      integration.connection.config?.mappings ??
        getDefaultIntegrationMappings(),
    )
  )
}

export function updateIntegrationMappingDrafts({
  drafts,
  integration,
  updater,
}: {
  drafts: IntegrationMappingDrafts
  integration: IntegrationSummary
  updater: (current: IntegrationMappingsConfig) => IntegrationMappingsConfig
}): IntegrationMappingDrafts {
  const base = getIntegrationMappingDraft({ drafts, integration })

  return {
    ...drafts,
    [integration.id]: updater(cloneIntegrationMappings(base)),
  }
}

export function clearIntegrationMappingDraft(
  drafts: IntegrationMappingDrafts,
  integrationId: string,
): IntegrationMappingDrafts {
  const next = { ...drafts }
  delete next[integrationId]
  return next
}

export function createEmptyIntegrationMappingRule(
  target: SyncTarget,
): IntegrationFieldMappingRule {
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

export function appendIntegrationMappingRule(
  mappings: IntegrationMappingsConfig,
  target: SyncTarget,
) {
  return {
    ...mappings,
    [target]: {
      fields: [
        ...mappings[target].fields,
        createEmptyIntegrationMappingRule(target),
      ],
    },
  }
}

export function updateIntegrationMappingRule(
  mappings: IntegrationMappingsConfig,
  target: SyncTarget,
  fieldId: string,
  updates: Partial<IntegrationFieldMappingRule>,
) {
  return {
    ...mappings,
    [target]: {
      fields: mappings[target].fields.map((field) =>
        field.id === fieldId ? { ...field, ...updates } : field,
      ),
    },
  }
}

export function removeIntegrationMappingRule(
  mappings: IntegrationMappingsConfig,
  target: SyncTarget,
  fieldId: string,
) {
  return {
    ...mappings,
    [target]: {
      fields: mappings[target].fields.filter((field) => field.id !== fieldId),
    },
  }
}

export function createIntegrationPreviewKey(
  integrationId: string,
  target: SyncTarget,
) {
  return `${integrationId}:${target}`
}

export function clearIntegrationPreviewsForIntegration<TPreview>(
  previews: Record<string, TPreview>,
  integrationId: string,
) {
  return Object.fromEntries(
    Object.entries(previews).filter(
      ([key]) => !key.startsWith(`${integrationId}:`),
    ),
  )
}

export function formatIntegrationPreviewPayload(
  payload: Record<string, unknown>,
) {
  return JSON.stringify(payload, null, 2)
}

export function formatIntegrationDateTime(value: string | null) {
  if (!value) return 'Ainda não disponível'

  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function formatIntegrationDuration(value: number | null | undefined) {
  if (!value || value <= 0) return 'Sem duração'
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${Math.round(value / 100) / 10}s`
  return `${Math.round(value / 6000) / 10} min`
}

export function integrationReadinessBadgeVariant(
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

export function integrationCoveragePercentage(
  coverage: IntegrationTargetCoverageSummary,
) {
  if (coverage.localCount === 0) return 0
  return Math.round((coverage.linkedCount / coverage.localCount) * 100)
}

export function integrationScheduleStatusVariant(
  status: IntegrationScheduleStatus,
) {
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

export function integrationScheduleStatusLabel(
  status: IntegrationScheduleStatus,
) {
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

export function integrationRunTriggerLabel(trigger: IntegrationRun['trigger']) {
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

export function fallbackIntegrationTargetSummary(
  target: SyncTarget,
): IntegrationTargetSyncSummary {
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

export function getIntegrationTargetSummary(
  integration: IntegrationSummary,
  target: SyncTarget,
) {
  return (
    integration.overview.targets.find((item) => item.target === target) ??
    fallbackIntegrationTargetSummary(target)
  )
}

export function buildIntegrationChecklist(integration: IntegrationSummary) {
  const customerTarget = getIntegrationTargetSummary(integration, 'customer')
  const serviceOrderTarget = getIntegrationTargetSummary(
    integration,
    'service_order',
  )
  const billingTarget = getIntegrationTargetSummary(
    integration,
    'billing_document',
  )

  return [
    {
      label: 'Endpoint configurado',
      done: Boolean(integration.connection.config?.baseUrl),
      help:
        integration.connection.config?.baseUrl ??
        'Informe a Base URL do conector.',
    },
    {
      label: 'Conexão validada',
      done:
        Boolean(integration.lastValidatedAt) &&
        !integration.lastValidationError,
      help: integration.lastValidationError
        ? integration.lastValidationError
        : integration.lastValidatedAt
          ? `Validada em ${formatIntegrationDateTime(integration.lastValidatedAt)}`
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

export function validateIntegrationBaseUrl(baseUrl: string) {
  if (!baseUrl.trim()) return null

  try {
    normalizeIntegrationBaseUrl(baseUrl)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Base URL inválida'
  }
}
