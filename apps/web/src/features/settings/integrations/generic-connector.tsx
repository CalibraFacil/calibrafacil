import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  getDefaultIntegrationMappings,
  INTEGRATION_CANONICAL_FIELDS,
  type IntegrationMappingFormatter,
  type IntegrationMappingsConfig,
} from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  appendIntegrationMappingRule,
  cloneIntegrationMappings,
  defaultIntegrationDraft,
  formatIntegrationDateTime,
  formatIntegrationPreviewPayload,
  getIntegrationVisibleTargets,
  integrationFormatterOptions,
  integrationReadinessBadgeVariant,
  integrationStatusBadgeMeta,
  removeIntegrationMappingRule,
  updateIntegrationMappingRule,
  validateIntegrationBaseUrl,
} from '@/features/settings/integrations-model'
import { previewIntegrationSync } from '@/features/settings/queries'
import type {
  IntegrationSummary,
  SyncPreviewResponse,
  SyncTarget,
} from '@/features/settings/types'
import { useConnectorMutations } from './mutations'
import { IntegrationActivity } from './activity'
import { IntegrationTargetList } from './target-list'
import { MetricTile, SectionTitle } from './shared'

// ── New connector form ────────────────────────────────────────────────────────

export function NewGenericConnectorForm({
  onRefresh,
}: {
  onRefresh: () => Promise<void>
}) {
  const [draft, setDraft] = useState(defaultIntegrationDraft)
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async () => calibraApi.integrations.create(draft),
    onSuccess: async () => {
      toast.success('Conector criado')
      setDraft(defaultIntegrationDraft)
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar conector',
      )
    },
  })

  const setField = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel>Nome</FieldLabel>
        <Input
          value={draft.name}
          onChange={(e) => setField('name', e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Base URL</FieldLabel>
        <Input
          placeholder="https://erp.exemplo.com/api/calibrafacil"
          value={draft.baseUrl}
          onBlur={() =>
            setBaseUrlError(validateIntegrationBaseUrl(draft.baseUrl))
          }
          onChange={(e) => {
            setField('baseUrl', e.target.value)
            setBaseUrlError(validateIntegrationBaseUrl(e.target.value))
          }}
        />
        <FieldDescription>Endpoint base do middleware HTTP.</FieldDescription>
        <FieldError>{baseUrlError}</FieldError>
      </Field>
      <Field>
        <FieldLabel>Token Bearer</FieldLabel>
        <Input
          type="password"
          value={draft.authToken}
          onChange={(e) => setField('authToken', e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Health Path</FieldLabel>
        <Input
          value={draft.healthPath}
          onChange={(e) => setField('healthPath', e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Customers Path</FieldLabel>
        <Input
          value={draft.customerPath}
          onChange={(e) => setField('customerPath', e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Service Orders Path</FieldLabel>
        <Input
          value={draft.serviceOrderPath}
          onChange={(e) => setField('serviceOrderPath', e.target.value)}
        />
      </Field>
      <Field className="md:col-span-2">
        <FieldLabel>Billing Documents Path</FieldLabel>
        <Input
          value={draft.billingDocumentPath}
          onChange={(e) => setField('billingDocumentPath', e.target.value)}
        />
      </Field>
      <div className="md:col-span-2 flex justify-end">
        <Button
          className="active:scale-[0.96]"
          onClick={() => createMutation.mutate()}
          disabled={
            createMutation.isPending ||
            !draft.baseUrl ||
            !draft.authToken ||
            !!baseUrlError
          }
        >
          {createMutation.isPending ? 'Criando…' : 'Criar conector'}
        </Button>
      </div>
    </FieldGroup>
  )
}

// ── Generic connector card ─────────────────────────────────────────────────────

export function GenericConnectorCard({
  integration,
  onRefresh,
}: {
  integration: IntegrationSummary
  onRefresh: () => Promise<void>
}) {
  const connector = useConnectorMutations({
    integrationId: integration.id,
    onRefresh,
  })
  const [draftMappings, setDraftMappings] =
    useState<IntegrationMappingsConfig | null>(null)
  const [previewByTarget, setPreviewByTarget] = useState<
    Record<string, SyncPreviewResponse>
  >({})

  const mappings =
    draftMappings ??
    cloneIntegrationMappings(
      integration.connection.config?.mappings ??
        getDefaultIntegrationMappings(),
    )

  const updateMutation = useMutation({
    mutationFn: async () =>
      calibraApi.integrations.update(integration.id, { mappings }),
    onSuccess: async () => {
      toast.success('Mapeamento salvo')
      setDraftMappings(null)
      setPreviewByTarget({})
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar mapeamento',
      )
    },
  })

  const previewMutation = useMutation({
    mutationFn: async (target: SyncTarget) =>
      previewIntegrationSync({ id: integration.id, target, mappings }),
    onSuccess: (data, target) => {
      setPreviewByTarget((current) => ({ ...current, [target]: data }))
      toast.success('Prévia pronta')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao montar prévia',
      )
    },
  })

  const statusBadge = integrationStatusBadgeMeta(integration)
  const readiness = integration.overview.readiness.readinessStatus
  const dependencyWarnings = integration.overview.readiness.dependencyWarnings

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{integration.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {integration.connection.config?.baseUrl ?? 'Sem conexão'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            <Badge variant={integrationReadinessBadgeVariant(readiness)}>
              {readiness === 'READY'
                ? 'Pronta'
                : readiness === 'DEGRADED'
                  ? 'Com dependências'
                  : 'Não pronta'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.96]"
              onClick={() => connector.validate.mutate()}
              disabled={connector.validate.isPending}
            >
              {connector.validate.isPending ? 'Validando…' : 'Validar'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.96]"
              onClick={() =>
                connector.toggle.mutate({
                  enabled: integration.status !== 'ACTIVE',
                })
              }
              disabled={
                connector.toggle.isPending ||
                integration.status === 'ACTION_REQUIRED'
              }
            >
              {integration.status === 'ACTION_REQUIRED'
                ? 'Reconecte'
                : integration.status === 'ACTIVE'
                  ? 'Desativar'
                  : 'Ativar'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile
            label="Validação"
            value={formatIntegrationDateTime(
              integration.overview.readiness.lastValidatedAt,
            )}
          />
          <MetricTile
            label="Último sync"
            value={formatIntegrationDateTime(
              integration.overview.syncSummary.lastRunAt,
            )}
          />
          <MetricTile
            label="Último sucesso"
            value={formatIntegrationDateTime(
              integration.overview.syncSummary.lastSuccessfulRunAt,
            )}
          />
          <MetricTile
            label="Último erro"
            value={formatIntegrationDateTime(
              integration.overview.syncSummary.lastErrorAt,
            )}
          />
        </div>

        {integration.lastValidationError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {integration.lastValidationError}
            </AlertDescription>
          </Alert>
        ) : null}

        {dependencyWarnings.length > 0 ? (
          <Alert>
            <AlertDescription>
              <div className="space-y-1">
                {dependencyWarnings.map((warning) => (
                  <p key={`${warning.target}:${warning.code}`}>
                    {warning.message}
                  </p>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3">
          <SectionTitle
            title="Pipelines de sincronização"
            description="Cobertura, agendamento, mapeamento de campos e disparo manual."
          />
          <IntegrationTargetList
            integration={integration}
            targets={getIntegrationVisibleTargets(integration)}
            sync={connector.sync}
            schedule={connector.schedule}
            renderExtra={(target) => (
              <MappingEditor
                target={target}
                mappings={mappings}
                preview={previewByTarget[target] ?? null}
                isSaving={updateMutation.isPending}
                isPreviewing={previewMutation.isPending}
                onChange={(updater) =>
                  setDraftMappings(updater(cloneIntegrationMappings(mappings)))
                }
                onPreview={() => previewMutation.mutate(target)}
                onSave={() => updateMutation.mutate()}
              />
            )}
          />
        </section>

        <IntegrationActivity
          integration={integration}
          retry={connector.retry}
        />
      </CardContent>
    </Card>
  )
}

// ── Mapping editor (generic only) ──────────────────────────────────────────────

function MappingEditor({
  isPreviewing,
  isSaving,
  mappings,
  onChange,
  onPreview,
  onSave,
  preview,
  target,
}: {
  isPreviewing: boolean
  isSaving: boolean
  mappings: IntegrationMappingsConfig
  onChange: (
    updater: (current: IntegrationMappingsConfig) => IntegrationMappingsConfig,
  ) => void
  onPreview: () => void
  onSave: () => void
  preview: SyncPreviewResponse | null
  target: SyncTarget
}) {
  const fields = mappings[target].fields

  return (
    <Collapsible className="rounded-lg bg-muted/40 ring-1 ring-inset ring-border/60">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium"
          />
        }
      >
        <span>Mapeamento de campos</span>
        <span className="tabular-nums text-muted-foreground">
          {fields.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs active:scale-[0.96]"
            onClick={() =>
              onChange((current) =>
                appendIntegrationMappingRule(current, target),
              )
            }
          >
            Adicionar campo
          </Button>
        </div>

        {fields.map((field) => (
          <div
            key={field.id}
            className="space-y-3 rounded-md bg-background p-3 ring-1 ring-inset ring-border/60"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={field.enabled}
                  onCheckedChange={(checked) =>
                    onChange((current) =>
                      updateIntegrationMappingRule(current, target, field.id, {
                        enabled: checked === true,
                      }),
                    )
                  }
                />
                <span className="text-sm font-medium">
                  {field.destinationField || 'Novo campo'}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  onChange((current) =>
                    removeIntegrationMappingRule(current, target, field.id),
                  )
                }
              >
                Remover
              </Button>
            </div>

            <Field>
              <FieldLabel>Destino</FieldLabel>
              <Input
                value={field.destinationField}
                placeholder="ex: externalCode"
                onChange={(e) =>
                  onChange((current) =>
                    updateIntegrationMappingRule(current, target, field.id, {
                      destinationField: e.target.value,
                    }),
                  )
                }
              />
            </Field>

            <div className="grid gap-3 md:grid-cols-3">
              <Field>
                <FieldLabel>Origem</FieldLabel>
                <Select
                  value={field.valueMode}
                  onValueChange={(value) =>
                    onChange((current) =>
                      updateIntegrationMappingRule(current, target, field.id, {
                        valueMode: value === 'constant' ? 'constant' : 'source',
                      }),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {field.valueMode === 'constant'
                        ? 'Valor constante'
                        : 'Campo do CalibraFácil'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="source">
                      Campo do CalibraFácil
                    </SelectItem>
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
                      onChange((current) =>
                        updateIntegrationMappingRule(
                          current,
                          target,
                          field.id,
                          {
                            sourceField: value,
                          },
                        ),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>{field.sourceField ?? ''}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {INTEGRATION_CANONICAL_FIELDS[target].map(
                        (sourceField) => (
                          <SelectItem key={sourceField} value={sourceField}>
                            {sourceField}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field>
                  <FieldLabel>Valor constante</FieldLabel>
                  <Input
                    value={field.constantValue ?? ''}
                    placeholder="ex: BRL"
                    onChange={(e) =>
                      onChange((current) =>
                        updateIntegrationMappingRule(
                          current,
                          target,
                          field.id,
                          {
                            constantValue: e.target.value,
                          },
                        ),
                      )
                    }
                  />
                </Field>
              )}

              <Field>
                <FieldLabel>Formato</FieldLabel>
                <Select
                  value={field.formatter}
                  onValueChange={(value) =>
                    onChange((current) =>
                      updateIntegrationMappingRule(current, target, field.id, {
                        formatter: normalizeFormatter(value),
                      }),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {integrationFormatterOptions.find(
                        (option) => option.value === field.formatter,
                      )?.label ?? field.formatter}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {integrationFormatterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="active:scale-[0.96]"
            onClick={onPreview}
            disabled={isPreviewing}
          >
            {isPreviewing ? 'Validando…' : 'Prévia'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="active:scale-[0.96]"
            onClick={onSave}
            disabled={isSaving}
          >
            {isSaving ? 'Salvando…' : 'Salvar mapeamento'}
          </Button>
        </div>

        {preview ? (
          <div className="space-y-2 border-t border-border/60 pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                Prévia · {preview.previewCount} registros
              </span>
              <Badge variant={preview.blocked ? 'destructive' : 'secondary'}>
                {preview.blocked ? 'Bloqueada' : 'Pronta'}
              </Badge>
            </div>
            {preview.sampleRecords.length > 0 ? (
              preview.sampleRecords.map((record) => (
                <div
                  key={record.externalId}
                  className="rounded-md bg-background p-2 ring-1 ring-inset ring-border/60"
                >
                  <p className="font-medium">{record.label}</p>
                  <p className="text-muted-foreground">
                    {record.subtitle ?? record.externalId}
                  </p>
                  {record.issues.map((issue) => (
                    <p
                      key={`${record.externalId}:${issue}`}
                      className="text-destructive"
                    >
                      {issue}
                    </p>
                  ))}
                  <pre className="mt-2 overflow-x-auto rounded bg-muted p-2">
                    {formatIntegrationPreviewPayload(record.mappedPayload)}
                  </pre>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                Nenhum registro candidato neste momento.
              </p>
            )}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function normalizeFormatter(value: string | null): IntegrationMappingFormatter {
  for (const option of integrationFormatterOptions) {
    if (option.value === value) return option.value
  }
  return 'none'
}
