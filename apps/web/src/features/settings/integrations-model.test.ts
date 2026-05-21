import { describe, expect, it } from 'vitest'

import {
  getDefaultIntegrationMappings,
  type IntegrationTargetCoverageSummary,
} from '@calibra-facil/shared'

import type { IntegrationSummary } from '@/features/settings/types'
import {
  appendIntegrationMappingRule,
  buildIntegrationActiveSummaries,
  buildIntegrationChecklist,
  canManageIntegrationSettings,
  clearIntegrationMappingDraft,
  clearIntegrationPreviewsForIntegration,
  cloneIntegrationMappings,
  createIntegrationPreviewKey,
  createEmptyIntegrationMappingRule,
  fallbackIntegrationTargetSummary,
  formatIntegrationDuration,
  formatIntegrationPreviewPayload,
  getIntegrationMappingDraft,
  getIntegrationSettingsRole,
  getIntegrationTargetSummary,
  integrationCoveragePercentage,
  integrationReadinessBadgeVariant,
  integrationRunTriggerLabel,
  integrationScheduleStatusLabel,
  integrationScheduleStatusVariant,
  removeIntegrationMappingRule,
  updateIntegrationMappingDrafts,
  updateIntegrationMappingRule,
  validateIntegrationBaseUrl,
} from './integrations-model'

function createIntegrationSummary(): IntegrationSummary {
  return {
    id: 'integration-1',
    type: 'financial_erp',
    provider: 'generic_http',
    name: 'ERP',
    status: 'ACTIVE',
    lastValidatedAt: null,
    lastValidationError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    connection: {
      id: 'connection-1',
      credentialType: 'bearer',
      config: {
        baseUrl: 'https://erp.example.com',
        healthPath: '/health',
        customerPath: '/customers',
        serviceOrderPath: '/service-orders',
        billingDocumentPath: '/billing-documents',
        authType: 'bearer',
        mappings: getDefaultIntegrationMappings(),
      },
    },
    recentRuns: [],
    recentEvents: [],
    overview: {
      readiness: {
        setupStatus: 'CONFIGURED',
        readinessStatus: 'READY',
        validationRequired: false,
        canSync: true,
        lastValidatedAt: null,
        lastValidationError: null,
        dependencyWarnings: [],
      },
      targets: [],
      syncSummary: {
        lastRunAt: null,
        lastSuccessfulRunAt: null,
        lastErrorAt: null,
        hasRecentFailures: false,
      },
    },
  }
}

describe('integrations-model', () => {
  it('derives integration management permission from organization members', () => {
    expect(
      getIntegrationSettingsRole('user-1', [
        { userId: 'user-1', role: 'admin' },
      ]),
    ).toBe('admin')
    expect(
      getIntegrationSettingsRole('user-2', [
        { user: { id: 'user-2' }, role: 'owner' },
      ]),
    ).toBe('owner')
    expect(getIntegrationSettingsRole('missing', [])).toBe('member')
    expect(canManageIntegrationSettings('admin')).toBe(true)
    expect(canManageIntegrationSettings('member')).toBe(false)
  })

  it('summarizes configured integrations for the settings header', () => {
    const ready = createIntegrationSummary()
    const degraded = createIntegrationSummary()
    degraded.id = 'integration-2'
    degraded.overview.readiness.readinessStatus = 'DEGRADED'
    degraded.overview.targets = [
      {
        ...fallbackIntegrationTargetSummary('customer'),
        schedule: {
          ...fallbackIntegrationTargetSummary('customer').schedule,
          mode: 'scheduled',
          status: 'scheduled',
        },
      },
    ]

    expect(buildIntegrationActiveSummaries([ready, degraded])).toEqual({
      total: 2,
      atRisk: 1,
      scheduledTargets: 1,
    })
  })

  it('clones mapping configs without sharing field objects', () => {
    const mappings = getDefaultIntegrationMappings()
    const cloned = cloneIntegrationMappings(mappings)

    cloned.customer.fields[0]!.destinationField = 'changed'

    expect(cloned).not.toBe(mappings)
    expect(cloned.customer.fields[0]).not.toBe(mappings.customer.fields[0])
    expect(mappings.customer.fields[0]!.destinationField).not.toBe('changed')
  })

  it('creates an enabled source mapping rule for a target', () => {
    const rule = createEmptyIntegrationMappingRule('service_order')

    expect(rule.id).toEqual(expect.any(String))
    expect(rule.enabled).toBe(true)
    expect(rule.valueMode).toBe('source')
    expect(rule.sourceField).toBe('externalId')
    expect(rule.formatter).toBe('none')
  })

  it('manages mapping drafts without mutating source configs', () => {
    const integration = createIntegrationSummary()
    const firstDraft = getIntegrationMappingDraft({ drafts: {}, integration })
    const updatedDrafts = updateIntegrationMappingDrafts({
      drafts: {},
      integration,
      updater: (current) =>
        updateIntegrationMappingRule(current, 'customer', 'customer:name', {
          destinationField: 'erpName',
        }),
    })

    expect(
      firstDraft.customer.fields.find((field) => field.id === 'customer:name')
        ?.destinationField,
    ).toBe('name')
    expect(
      updatedDrafts[integration.id]?.customer.fields.find(
        (field) => field.id === 'customer:name',
      )?.destinationField,
    ).toBe('erpName')
    expect(clearIntegrationMappingDraft(updatedDrafts, integration.id)).toEqual(
      {},
    )
  })

  it('applies mapping rule additions and removals through immutable helpers', () => {
    const mappings = getDefaultIntegrationMappings()
    const withExtra = appendIntegrationMappingRule(mappings, 'customer')
    const extra = withExtra.customer.fields.at(-1)

    expect(extra?.destinationField).toBe('')
    expect(withExtra.customer.fields).toHaveLength(
      mappings.customer.fields.length + 1,
    )
    expect(mappings.customer.fields).toHaveLength(
      getDefaultIntegrationMappings().customer.fields.length,
    )

    const withoutExtra = removeIntegrationMappingRule(
      withExtra,
      'customer',
      extra!.id,
    )

    expect(withoutExtra.customer.fields).toHaveLength(
      mappings.customer.fields.length,
    )
  })

  it('builds preview keys and clears previews for an integration', () => {
    const previews = {
      [createIntegrationPreviewKey('integration-1', 'customer')]: { count: 1 },
      [createIntegrationPreviewKey('integration-2', 'customer')]: { count: 2 },
    }

    expect(
      clearIntegrationPreviewsForIntegration(previews, 'integration-1'),
    ).toEqual({
      'integration-2:customer': { count: 2 },
    })
  })

  it('formats compact integration values', () => {
    expect(formatIntegrationPreviewPayload({ id: 1 })).toBe(
      JSON.stringify({ id: 1 }, null, 2),
    )
    expect(formatIntegrationDuration(null)).toBe('Sem duração')
    expect(formatIntegrationDuration(850)).toBe('850 ms')
    expect(formatIntegrationDuration(12_340)).toBe('12.3s')
    expect(formatIntegrationDuration(120_000)).toBe('2 min')
  })

  it('maps status values to labels and badge variants', () => {
    expect(integrationReadinessBadgeVariant('READY')).toBe('default')
    expect(integrationReadinessBadgeVariant('DEGRADED')).toBe('secondary')
    expect(integrationReadinessBadgeVariant('NOT_READY')).toBe('destructive')
    expect(integrationScheduleStatusLabel('running')).toBe('Executando')
    expect(integrationScheduleStatusVariant('blocked')).toBe('destructive')
    expect(integrationRunTriggerLabel('retry')).toBe('Reprocessado')
  })

  it('derives target summaries and coverage percentages', () => {
    const integration = createIntegrationSummary()
    const customerCoverage = {
      target: 'customer',
      localCount: 10,
      linkedCount: 7,
      unlinkedCount: 3,
    } satisfies IntegrationTargetCoverageSummary
    const customerSummary = {
      ...fallbackIntegrationTargetSummary('customer'),
      coverage: customerCoverage,
      blocked: false,
    }
    integration.overview.targets = [customerSummary]

    expect(getIntegrationTargetSummary(integration, 'customer')).toBe(
      customerSummary,
    )
    expect(
      getIntegrationTargetSummary(integration, 'service_order').blocked,
    ).toBe(true)
    expect(integrationCoveragePercentage(customerSummary.coverage)).toBe(70)
    expect(
      integrationCoveragePercentage({
        target: 'customer',
        localCount: 0,
        linkedCount: 0,
        unlinkedCount: 0,
      }),
    ).toBe(0)
  })

  it('builds the readiness checklist from integration state', () => {
    const integration = createIntegrationSummary()
    integration.lastValidationError = 'Health endpoint indisponível'
    integration.overview.targets = [
      {
        ...fallbackIntegrationTargetSummary('customer'),
        coverage: {
          target: 'customer',
          localCount: 3,
          linkedCount: 3,
          unlinkedCount: 0,
        },
      },
      {
        ...fallbackIntegrationTargetSummary('service_order'),
        blocked: false,
      },
      {
        ...fallbackIntegrationTargetSummary('billing_document'),
        blocked: true,
        warnings: [
          {
            target: 'billing_document',
            code: 'SERVICE_ORDERS_NOT_SYNCED',
            severity: 'warning',
            message: 'Ordens pendentes.',
          },
        ],
      },
    ]

    expect(buildIntegrationChecklist(integration)).toMatchObject([
      { label: 'Endpoint configurado', done: true },
      {
        label: 'Conexão validada',
        done: false,
        help: 'Health endpoint indisponível',
      },
      { label: 'Clientes com vínculo remoto', done: true },
      { label: 'Ordens liberadas para sync', done: true },
      { label: 'Faturamento liberado', done: false, help: 'Ordens pendentes.' },
    ])
  })

  it('validates optional base URLs through the shared normalizer', () => {
    expect(validateIntegrationBaseUrl('')).toBeNull()
    expect(validateIntegrationBaseUrl('https://erp.example.com')).toBeNull()
    expect(validateIntegrationBaseUrl('not a url')).toEqual(expect.any(String))
  })
})
