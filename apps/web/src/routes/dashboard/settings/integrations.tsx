import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/dashboard/settings/integrations')({
  head: () => ({
    meta: [{ title: 'Integrações | Configurações | CalibraFácil' }],
  }),
  component: IntegrationsSettingsPage,
})

interface IntegrationConfig {
  baseUrl: string
  healthPath: string
  customerPath: string
  serviceOrderPath: string
  billingDocumentPath: string
  authType: 'bearer'
}

interface IntegrationRun {
  id: string
  target: 'customer' | 'service_order' | 'billing_document'
  trigger: 'manual' | 'event'
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL'
  processedCount: number
  successCount: number
  errorCount: number
  errorSummary: string | null
  createdAt: string
}

interface IntegrationEvent {
  id: number
  level: 'info' | 'warning' | 'error'
  event: string
  message: string
  createdAt: string
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

async function parseApiError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null)

  if (data && typeof data === 'object') {
    if ('error' in data && typeof data.error === 'string') return data.error
    if ('message' in data && typeof data.message === 'string')
      return data.message
  }

  return fallback
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

function IntegrationsSettingsPage() {
  const queryClient = useQueryClient()
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()
  const currentOrgRole =
    typeof activeOrg?.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : 'member'
  const canManage = currentOrgRole === 'owner' || currentOrgRole === 'admin'
  const [draft, setDraft] = useState(defaultDraft)

  const integrationsQuery = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const res = await api.api.integrations.$get()

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao carregar integrações'),
        )
      }

      return res.json() as Promise<IntegrationsResponse>
    },
    enabled: canManage,
  })

  const refreshIntegrations = async () => {
    await queryClient.invalidateQueries({ queryKey: ['integrations'] })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.integrations.$post({
        json: draft,
      })

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao criar integração'),
        )
      }

      return res.json()
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
      const res = await api.api.integrations[':id'].validate.$post({
        param: { id },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao validar conexão'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Conexão validada')
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar conexão',
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
      const res = await api.api.integrations[':id'].toggle.$post({
        param: { id },
        json: { enabled },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar status'))
      }

      return res.json()
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

  const syncMutation = useMutation({
    mutationFn: async ({
      id,
      target,
    }: {
      id: string
      target: 'customer' | 'service_order' | 'billing_document'
    }) => {
      const res = await api.api.integrations[':id'].sync.$post({
        param: { id },
        json: { target, limit: 50 },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao iniciar sync'))
      }

      return res.json()
    },
    onSuccess: async (data) => {
      toast.success(
        data && typeof data === 'object' && 'queued' in data && data.queued
          ? 'Sincronização enfileirada'
          : 'Sincronização concluída',
      )
      await refreshIntegrations()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao iniciar sync',
      )
    },
  })

  if (isLoadingOrg) {
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

  const payload = integrationsQuery.data
  const hasEntitlement = payload.billing.hasCustomIntegrations

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Integrações Enterprise</CardTitle>
          <CardDescription>
            Configure um conector ERP financeiro genérico, valide a conexão e
            acompanhe os syncs manuais.
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
            <Badge variant="outline">Escopo: ERP financeiro</Badge>
          </div>

          {!hasEntitlement && (
            <p className="text-sm text-muted-foreground">
              O entitlement <code>custom_integrations</code> está disponível
              apenas no plano Enterprise. Você ainda pode visualizar
              configurações existentes, mas não criar nem sincronizar novas
              integrações.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nova Integração</CardTitle>
          <CardDescription>
            Informe o endpoint do middleware ERP que receberá os payloads
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
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    baseUrl: e.target.value,
                  }))
                }
              />
              <FieldDescription>
                Endpoint base do conector HTTP do ERP.
              </FieldDescription>
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
                !draft.authToken
              }
            >
              {createMutation.isPending ? 'Criando...' : 'Criar integração'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {payload.data.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Nenhuma integração configurada</CardTitle>
              <CardDescription>
                Crie sua primeira integração enterprise para sincronizar
                clientes, ordens de serviço e documentos financeiros.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          payload.data.map((integration) => (
            <Card key={integration.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
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
                    {integration.lastValidationError ? (
                      <Badge variant="destructive">Validação com erro</Badge>
                    ) : integration.lastValidatedAt ? (
                      <Badge variant="outline">Validada</Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => validateMutation.mutate(integration.id)}
                    disabled={!hasEntitlement || validateMutation.isPending}
                  >
                    Testar conexão
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

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Sync manual</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        syncMutation.mutate({
                          id: integration.id,
                          target: 'customer',
                        })
                      }
                      disabled={!hasEntitlement || syncMutation.isPending}
                    >
                      Sincronizar clientes
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        syncMutation.mutate({
                          id: integration.id,
                          target: 'service_order',
                        })
                      }
                      disabled={!hasEntitlement || syncMutation.isPending}
                    >
                      Sincronizar ordens
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        syncMutation.mutate({
                          id: integration.id,
                          target: 'billing_document',
                        })
                      }
                      disabled={!hasEntitlement || syncMutation.isPending}
                    >
                      Sincronizar faturamento
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Execuções recentes</h3>
                    {integration.recentRuns.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma execução registrada.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {integration.recentRuns.map((run) => (
                          <div
                            key={run.id}
                            className="rounded-md border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{run.target}</span>
                              <Badge variant="outline">{run.status}</Badge>
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {run.successCount}/{run.processedCount} itens com
                              sucesso
                            </p>
                            {run.errorSummary && (
                              <p className="mt-1 text-destructive">
                                {run.errorSummary}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Eventos recentes</h3>
                    {integration.recentEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum evento registrado.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {integration.recentEvents.map((event) => (
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
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

function IntegrationsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}
