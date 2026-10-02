import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DatabaseSyncIcon,
} from '@hugeicons/core-free-icons'

import type {
  ContaAzulConnectionConfig,
  ContaAzulConnectionConfigInput,
} from '@calibra-facil/shared'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  buildIntegrationChecklist,
  formatIntegrationDateTime,
  getIntegrationVisibleTargets,
} from '@/features/settings/integrations-model'
import type { IntegrationSummary } from '@/features/settings/types'
import type { ContaAzulScheduleResponse } from '@/features/settings/types'
import type { ConnectorMutations } from './mutations'
import type { ContaAzulMutations } from './conta-azul-mutations'
import {
  type ContaAzulCatalogQuery,
  type ContaAzulCatalogs,
  getFiscalTaxonomyValue,
  updateFiscalTaxonomyValue,
} from './conta-azul-catalogs'
import {
  contaAzulDomainGroups,
  contaAzulExportModeOptions,
  contaAzulBudgetModeOptions,
  contaAzulFiscalModeOptions,
  contaAzulProtocolModeOptions,
  contaAzulScheduleRows,
  contaAzulSaleTriggerOptions,
} from './conta-azul-constants'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  ContaAzulCatalogSelect,
  ContaAzulOptionSelect,
  ContaAzulTextSetting,
  DomainSwitchRow,
} from './conta-azul-fields'
import { IntegrationTargetList } from './target-list'
import { ChecklistRow, MetricTile, SectionTitle } from './shared'

type ConfigChange = (input: ContaAzulConnectionConfigInput) => void

// ── Overview ────────────────────────────────────────────────────────────────

export function ContaAzulOverviewTab({
  config,
  disabled,
  integration,
  mutations,
  scheduleState,
}: {
  config: ContaAzulConnectionConfig
  disabled: boolean
  integration: IntegrationSummary
  mutations: ContaAzulMutations
  scheduleState: {
    data?: ContaAzulScheduleResponse
    isError: boolean
    isLoading: boolean
  }
}) {
  const checklist = buildIntegrationChecklist(integration)
  const remoteDocuments = integration.overview.remoteDocuments

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile
          label="Token expira"
          value={formatIntegrationDateTime(config.accessTokenExpiresAt)}
        />
        <MetricTile
          label="Docs remotos"
          value={`${remoteDocuments.availableCount}/${remoteDocuments.totalCount}`}
        />
        <MetricTile
          label="PDF / XML"
          value={`${remoteDocuments.salePdfCount}/${remoteDocuments.fiscalXmlCount}`}
        />
        <MetricTile
          label="Conciliação"
          value={formatIntegrationDateTime(
            config.polling.receivablesLastRemoteUpdatedAt,
          )}
        />
        <MetricTile
          label="Último fiscal"
          value={formatIntegrationDateTime(
            config.polling.invoicesLastRemoteUpdatedAt,
          )}
        />
        <MetricTile
          label="Último drift"
          value={formatIntegrationDateTime(config.polling.driftLastCheckedAt)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-1">
          <SectionTitle
            title="Prontidão"
            description="Checklist de rollout antes de operar em produção."
          />
          <div className="mt-2 divide-y divide-border/60">
            {checklist.map((item) => (
              <ChecklistRow
                key={item.label}
                done={item.done}
                label={item.label}
                help={item.help}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <AutomaticSyncPanel scheduleState={scheduleState} />

          <SectionTitle
            icon={DatabaseSyncIcon}
            title="Reconciliação"
            description="Consultas sob demanda quando não há webhooks ativos."
          />
          <div className="flex flex-wrap gap-2">
            <PollButton
              mutation={mutations.pollReceivables}
              label="Pagamentos"
              busyLabel="Consultando…"
              disabled={disabled || !config.enabledTargets.paymentStatusPolling}
            />
            <PollButton
              mutation={mutations.pollPayables}
              label="Contas a pagar"
              busyLabel="Consultando…"
              disabled={disabled || !config.enabledTargets.payables}
            />
            <PollButton
              mutation={mutations.pollFiscal}
              label="Fiscal"
              busyLabel="Consultando…"
              disabled={disabled || !config.enabledTargets.fiscalDocuments}
            />
            <PollButton
              mutation={mutations.pollProtocols}
              label="Protocolos"
              busyLabel="Consultando…"
              disabled={
                disabled ||
                !config.enabledTargets.protocols ||
                config.protocolMode !== 'api_lookup_verified'
              }
            />
            <PollButton
              mutation={mutations.pollDrift}
              label="Verificar drift"
              busyLabel="Verificando…"
              disabled={disabled || !config.enabledTargets.driftChecks}
            />
          </div>
        </section>
      </div>
    </div>
  )
}

function PollButton({
  busyLabel,
  disabled,
  label,
  mutation,
}: {
  busyLabel: string
  disabled: boolean
  label: string
  mutation: { isPending: boolean; mutate: () => void }
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="active:scale-[0.96]"
      onClick={() => mutation.mutate()}
      disabled={disabled || mutation.isPending}
    >
      {mutation.isPending ? (
        <Spinner className="mr-1.5 size-4" />
      ) : (
        <HugeiconsIcon icon={DatabaseSyncIcon} className="mr-1.5 size-4" />
      )}
      {mutation.isPending ? busyLabel : label}
    </Button>
  )
}

export function AutomaticSyncPanel({
  scheduleState,
}: {
  scheduleState: {
    data?: ContaAzulScheduleResponse
    isError: boolean
    isLoading: boolean
  }
}) {
  const scheduleData = scheduleState.data
  return (
    <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-inset ring-border/70">
      <SectionTitle
        icon={DatabaseSyncIcon}
        title="Sincronização automática"
        description="A integração é consultada em segundo plano porque não há webhooks ativos."
      />

      {scheduleState.isLoading ? (
        <ul
          aria-label="Sincronização automática"
          className="grid gap-2 md:grid-cols-2"
        >
          {contaAzulScheduleRows.map((row) => (
            <li
              key={row.key}
              className="h-28 animate-pulse rounded-lg bg-muted/50"
            />
          ))}
        </ul>
      ) : scheduleState.isError ? (
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar a agenda automática.
        </p>
      ) : scheduleData ? (
        <ul
          aria-label="Sincronização automática"
          className="grid gap-2 md:grid-cols-2"
        >
          {contaAzulScheduleRows.map((row) => (
            <AutomaticSyncRow
              key={row.key}
              label={row.label}
              description={row.description}
              schedule={getScheduleRow(scheduleData, row.key)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type AutomaticSyncScheduleKey = (typeof contaAzulScheduleRows)[number]['key']
type AutomaticSyncScheduleRow =
  ContaAzulScheduleResponse[AutomaticSyncScheduleKey]

function getScheduleRow(
  data: ContaAzulScheduleResponse,
  key: AutomaticSyncScheduleKey,
): AutomaticSyncScheduleRow {
  return (
    data[key] ?? {
      enabled: false,
      intervalMinutes: 0,
      lastErrorAt: null,
      lastErrorMessage: null,
      lastSuccessAt: null,
      nextDueAt: null,
    }
  )
}

function AutomaticSyncRow({
  description,
  label,
  schedule,
}: {
  description: string
  label: string
  schedule: AutomaticSyncScheduleRow
}) {
  const state = getAutomaticSyncState(schedule)
  const meta = automaticSyncStateMeta[state]

  return (
    <li
      className={cn(
        'min-h-28 rounded-lg bg-muted/30 p-3 ring-1 ring-inset ring-border/60',
        !schedule.enabled && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium leading-none">{label}</p>
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        <Badge
          variant={meta.variant}
          aria-label={`${label}: ${meta.ariaLabel}`}
          className="shrink-0"
        >
          <HugeiconsIcon icon={meta.icon} className="size-3" />
          {meta.label}
        </Badge>
      </div>

      <div className="mt-3 space-y-1 text-xs tabular-nums text-muted-foreground">
        <p title={schedule.lastSuccessAt ?? undefined}>
          Última execução: {formatScheduleTimestamp(schedule.lastSuccessAt)}
        </p>
        <p title={schedule.nextDueAt ?? undefined}>
          Próxima execução: {formatScheduleTimestamp(schedule.nextDueAt, true)}
        </p>
        {schedule.lastErrorMessage ? (
          <p
            className="truncate text-destructive"
            title={schedule.lastErrorMessage}
          >
            {schedule.lastErrorMessage}
          </p>
        ) : null}
      </div>
    </li>
  )
}

type AutomaticSyncState =
  | 'disabled'
  | 'awaiting_first_run'
  | 'healthy'
  | 'failed'
  | 'stuck'

const automaticSyncStateMeta = {
  disabled: {
    ariaLabel: 'desabilitada',
    icon: Clock01Icon,
    label: 'Desabilitado',
    variant: 'secondary',
  },
  awaiting_first_run: {
    ariaLabel: 'aguardando primeira execução',
    icon: Clock01Icon,
    label: 'Aguardando',
    variant: 'outline',
  },
  healthy: {
    ariaLabel: 'execução automática saudável',
    icon: CheckmarkCircle02Icon,
    label: 'OK',
    variant: 'secondary',
  },
  failed: {
    ariaLabel: 'última execução falhou',
    icon: Alert02Icon,
    label: 'Falhou',
    variant: 'destructive',
  },
  stuck: {
    ariaLabel: 'execução automática atrasada',
    icon: Alert02Icon,
    label: 'Atrasado',
    variant: 'outline',
  },
} as const satisfies Record<
  AutomaticSyncState,
  {
    ariaLabel: string
    icon: IconSvgElement
    label: string
    variant: 'secondary' | 'outline' | 'destructive'
  }
>

function getAutomaticSyncState(
  schedule: AutomaticSyncScheduleRow,
): AutomaticSyncState {
  if (!schedule.enabled) return 'disabled'
  if (schedule.lastErrorAt && !schedule.lastSuccessAt) return 'failed'
  if (!schedule.lastSuccessAt) return 'awaiting_first_run'
  if (schedule.lastErrorAt && schedule.lastErrorAt > schedule.lastSuccessAt) {
    return 'failed'
  }

  const nextDue = schedule.nextDueAt ? new Date(schedule.nextDueAt) : null
  if (nextDue && Date.now() - nextDue.getTime() > 24 * 60 * 60 * 1000) {
    return 'stuck'
  }

  return 'healthy'
}

function formatScheduleTimestamp(value: string | null, future = false) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'

  const diffMs = parsed.getTime() - Date.now()
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60_000))
  const unit =
    absMinutes >= 60 ? `${Math.round(absMinutes / 60)} h` : `${absMinutes} min`

  if (future || diffMs > 0) {
    return `em ~${unit}`
  }

  return `há ${unit}`
}

// ── Sync ──────────────────────────────────────────────────────────────────

export function ContaAzulSyncTab({
  config,
  integration,
  onConfigChange,
  schedule,
  sync,
}: {
  config: ContaAzulConnectionConfig
  integration: IntegrationSummary
  onConfigChange: ConfigChange
  schedule: ConnectorMutations['schedule']
  sync: ConnectorMutations['sync']
}) {
  // Domain toggles never reuse the broader busy flag (true while any config
  // mutation is in flight): that dimmed every switch at once when one was
  // clicked, which users read as "everything turned off". Each toggle's
  // mutation is independent and the server merges partial enabledTargets onto
  // the current state, so the others stay clickable mid-request.
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle
          title="Pipelines de sincronização"
          description="Cobertura remota, agendamento e disparo manual por alvo."
        />
        <IntegrationTargetList
          integration={integration}
          targets={getIntegrationVisibleTargets(integration)}
          sync={sync}
          schedule={schedule}
        />
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Domínios sincronizados"
          description="Ative apenas os domínios necessários para o seu fluxo."
        />
        <Accordion
          multiple
          defaultValue={[contaAzulDomainGroups[0].title]}
          className="rounded-xl bg-card px-4 ring-1 ring-inset ring-border/70"
        >
          {contaAzulDomainGroups.map((group) => {
            const enabledCount = group.domains.filter(
              (domain) => config.enabledTargets[domain.key],
            ).length
            return (
              <AccordionItem key={group.title} value={group.title}>
                <AccordionTrigger>
                  <span className="flex items-center gap-2.5">
                    <HugeiconsIcon
                      icon={group.icon}
                      className="size-4 text-muted-foreground"
                    />
                    <span className="font-medium">{group.title}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {enabledCount}/{group.domains.length}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {group.domains.map((domain) => (
                      <DomainSwitchRow
                        key={domain.key}
                        label={domain.label}
                        description={domain.description}
                        checked={config.enabledTargets[domain.key]}
                        onCheckedChange={(checked) =>
                          onConfigChange({
                            enabledTargets: { [domain.key]: checked },
                          })
                        }
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </section>
    </div>
  )
}

// ── Defaults ────────────────────────────────────────────────────────────────

export function ContaAzulDefaultsTab({
  catalogs,
  config,
  disabled,
  onConfigChange,
}: {
  catalogs: ContaAzulCatalogs
  config: ContaAzulConnectionConfig
  disabled: boolean
  onConfigChange: ConfigChange
}) {
  const taxonomy = config.defaultFiscalTaxonomy

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle
          title="Comportamento de exportação"
          description="Como vendas, orçamentos, fiscal e protocolos são tratados."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ContaAzulOptionSelect
            label="Modo de exportação"
            value={config.exportMode}
            options={contaAzulExportModeOptions}
            disabled={disabled}
            onChange={(value) => onConfigChange({ exportMode: value })}
          />
          <ContaAzulOptionSelect
            label="Modo de orçamento"
            value={config.budgetMode}
            options={contaAzulBudgetModeOptions}
            disabled={disabled}
            onChange={(value) => onConfigChange({ budgetMode: value })}
          />
          <ContaAzulOptionSelect
            label="Gatilho de venda"
            value={config.saleTrigger}
            options={contaAzulSaleTriggerOptions}
            disabled={disabled}
            onChange={(value) => onConfigChange({ saleTrigger: value })}
          />
          <ContaAzulOptionSelect
            label="Modo fiscal"
            value={config.fiscalMode}
            options={contaAzulFiscalModeOptions}
            disabled={disabled}
            onChange={(value) => onConfigChange({ fiscalMode: value })}
          />
          <ContaAzulOptionSelect
            label="Modo de protocolos"
            value={config.protocolMode}
            options={contaAzulProtocolModeOptions}
            disabled={disabled}
            onChange={(value) => onConfigChange({ protocolMode: value })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Referências padrão"
          description="Valores aplicados quando um registro não traz a referência própria."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CatalogField
            label="Conta financeira"
            query={catalogs.accounts}
            value={config.defaultFinancialAccountId}
            disabled={disabled}
            errorLabel="Falha ao carregar contas"
            placeholder="Conta usada para baixas e recebíveis."
            onChange={(value) =>
              onConfigChange({ defaultFinancialAccountId: value })
            }
          />
          <CatalogField
            label="Categoria"
            query={catalogs.categories}
            value={config.defaultCategoryId}
            disabled={disabled}
            errorLabel="Falha ao carregar categorias"
            placeholder="Categoria financeira padrão de receita."
            onChange={(value) => onConfigChange({ defaultCategoryId: value })}
          />
          <CatalogField
            label="Categoria de despesa"
            query={catalogs.categories}
            value={config.defaultExpenseCategoryId}
            disabled={disabled}
            errorLabel="Falha ao carregar categorias"
            placeholder="Categoria padrão para contas a pagar."
            onChange={(value) =>
              onConfigChange({ defaultExpenseCategoryId: value })
            }
          />
          <CatalogField
            label="Centro de custo"
            query={catalogs.costCenters}
            value={config.defaultCostCenterId}
            disabled={disabled}
            errorLabel="Falha ao carregar centros"
            placeholder="Centro de custo aplicado por padrão."
            onChange={(value) => onConfigChange({ defaultCostCenterId: value })}
          />
          <CatalogField
            label="Categoria DRE"
            query={catalogs.dreCategories}
            value={config.defaultDreCategoryId}
            disabled={disabled}
            errorLabel="Falha ao carregar categorias DRE"
            placeholder="Classificação gerencial padrão."
            onChange={(value) =>
              onConfigChange({ defaultDreCategoryId: value })
            }
          />
          <CatalogField
            label="Vendedor"
            query={catalogs.sellers}
            value={config.defaultSellerId}
            disabled={disabled}
            errorLabel="Falha ao carregar vendedores"
            placeholder="Responsável comercial padrão."
            onChange={(value) => onConfigChange({ defaultSellerId: value })}
          />
          <CatalogField
            label="Categoria de produto"
            query={catalogs.productCategories}
            value={config.defaultProductCategoryId}
            disabled={disabled}
            errorLabel="Falha ao carregar categorias de produto"
            placeholder="Categoria padrão de produtos."
            onChange={(value) =>
              onConfigChange({ defaultProductCategoryId: value })
            }
          />
          <CatalogField
            label="Categoria de serviço"
            query={catalogs.services}
            value={config.defaultServiceCategoryId}
            disabled={disabled}
            errorLabel="Falha ao carregar serviços"
            placeholder="Referência de serviço padrão."
            onChange={(value) =>
              onConfigChange({ defaultServiceCategoryId: value })
            }
          />
          <CatalogField
            label="Unidade de medida"
            query={catalogs.productUnits}
            value={config.defaultUnitOfMeasureId}
            disabled={disabled}
            errorLabel="Falha ao carregar unidades"
            placeholder="Unidade padrão de produtos."
            onChange={(value) =>
              onConfigChange({ defaultUnitOfMeasureId: value })
            }
          />
          <ContaAzulTextSetting
            label="Método de pagamento"
            value={config.defaultPaymentMethodId}
            disabled={disabled}
            placeholder="Valor oficial da Conta Azul, ex.: PIX."
            onChange={(value) =>
              onConfigChange({ defaultPaymentMethodId: value })
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Taxonomia fiscal padrão"
          description="Aplicada a produtos sem classificação fiscal própria."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CatalogField
            label="NCM"
            query={catalogs.productNcm}
            value={getFiscalTaxonomyValue(taxonomy, 'ncmId')}
            disabled={disabled}
            errorLabel="Falha ao carregar NCM"
            placeholder="Classificação NCM padrão."
            onChange={(value) =>
              onConfigChange({
                defaultFiscalTaxonomy: updateFiscalTaxonomyValue(
                  taxonomy,
                  'ncmId',
                  value,
                ),
              })
            }
          />
          <CatalogField
            label="CEST"
            query={catalogs.productCest}
            value={getFiscalTaxonomyValue(taxonomy, 'cestId')}
            disabled={disabled}
            errorLabel="Falha ao carregar CEST"
            placeholder="Classificação CEST padrão."
            onChange={(value) =>
              onConfigChange({
                defaultFiscalTaxonomy: updateFiscalTaxonomyValue(
                  taxonomy,
                  'cestId',
                  value,
                ),
              })
            }
          />
          <ContaAzulTextSetting
            label="Origem fiscal"
            value={getFiscalTaxonomyValue(taxonomy, 'origem')}
            disabled={disabled}
            placeholder="Valor oficial aceito no cadastro fiscal."
            onChange={(value) =>
              onConfigChange({
                defaultFiscalTaxonomy: updateFiscalTaxonomyValue(
                  taxonomy,
                  'origem',
                  value,
                ),
              })
            }
          />
          <ContaAzulTextSetting
            label="Tipo de produto fiscal"
            value={getFiscalTaxonomyValue(taxonomy, 'tipoProduto')}
            disabled={disabled}
            placeholder="Valor oficial aceito no cadastro fiscal."
            onChange={(value) =>
              onConfigChange({
                defaultFiscalTaxonomy: updateFiscalTaxonomyValue(
                  taxonomy,
                  'tipoProduto',
                  value,
                ),
              })
            }
          />
        </div>
      </section>
    </div>
  )
}

function CatalogField({
  disabled,
  errorLabel,
  label,
  onChange,
  placeholder,
  query,
  value,
}: {
  disabled: boolean
  errorLabel: string
  label: string
  onChange: (value: string | null) => void
  placeholder: string
  query: ContaAzulCatalogQuery
  value: string | null
}) {
  return (
    <ContaAzulCatalogSelect
      label={label}
      value={value}
      items={query.data?.items ?? []}
      isLoading={query.isLoading}
      disabled={disabled || query.isError}
      placeholder={query.isError ? errorLabel : placeholder}
      onChange={onChange}
    />
  )
}
