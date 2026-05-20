import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PortalDomainResponse } from '@calibra-facil/client-runtime'

import { usePlanAccess } from '@/hooks/use-plan-access'
import { calibraApi } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const Route = createFileRoute('/dashboard/settings/portal-domain')({
  head: () => ({
    meta: [{ title: 'Portal Domain | Configurações | CalibraFácil' }],
  }),
  component: PortalDomainSettingsPage,
})

function formatDateTime(value: string | Date | null) {
  if (!value) return 'Ainda não disponível'

  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function statusVariant(
  status: PortalDomainResponse['statusSummary']['status'],
) {
  switch (status) {
    case 'active':
      return 'default'
    case 'verified':
    case 'ready_to_verify':
      return 'secondary'
    case 'token_mismatch':
      return 'destructive'
    default:
      return 'outline'
  }
}

function statusLabel(status: PortalDomainResponse['statusSummary']['status']) {
  switch (status) {
    case 'not_configured':
      return 'Não configurado'
    case 'waiting_dns':
      return 'Aguardando DNS'
    case 'token_mismatch':
      return 'TXT divergente'
    case 'ready_to_verify':
      return 'Pronto para verificar'
    case 'verified':
      return 'Verificado'
    case 'active':
      return 'Ativo'
  }
}

function PortalDomainSettingsPage() {
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const [hostname, setHostname] = useState('')

  const domainQuery = useQuery({
    queryKey: ['portal-domain'],
    queryFn: () => calibraApi.portalDomains.get(),
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['portal-domain'] })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.portalDomains.create({ hostname })
    },
    onSuccess: async () => {
      toast.success('Domínio salvo. Configure o TXT e valide o lifecycle.')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar domínio',
      )
    },
  })

  const verifyMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.portalDomains.verify()
    },
    onSuccess: async () => {
      toast.success('Domínio verificado')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao verificar domínio',
      )
    },
  })

  const activateMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.portalDomains.activate()
    },
    onSuccess: async () => {
      toast.success('Domínio ativado')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao ativar domínio',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.portalDomains.delete()
    },
    onSuccess: async () => {
      setHostname('')
      toast.success('Domínio removido')
      await refresh()
    },
    onError: () => {
      toast.error('Falha ao remover domínio')
    },
  })

  if (domainQuery.isLoading || accessQuery.isLoading) {
    return <PortalDomainSkeleton />
  }

  if (domainQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portal Domain</CardTitle>
          <CardDescription>
            {domainQuery.error instanceof Error
              ? domainQuery.error.message
              : 'Falha ao carregar domínio do portal'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const hasCustomDomain = accessQuery.data?.hasCustomDomain ?? false
  const payload = domainQuery.data
  if (!payload) {
    return <PortalDomainSkeleton />
  }

  const domain = payload.domain

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Portal Domain</CardTitle>
          <CardDescription>
            Workspace dedicado para configurar, verificar e ativar o domínio
            personalizado do portal. O dashboard continua no domínio principal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(payload.statusSummary.status)}>
              {statusLabel(payload.statusSummary.status)}
            </Badge>
            <Badge
              variant={
                payload.statusSummary.readiness === 'active'
                  ? 'default'
                  : payload.statusSummary.readiness === 'ready'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {payload.statusSummary.readiness === 'active'
                ? 'Em produção'
                : payload.statusSummary.readiness === 'ready'
                  ? 'Pronto'
                  : 'Não pronto'}
            </Badge>
            {!hasCustomDomain && <Badge variant="outline">Professional+</Badge>}
          </div>

          {!hasCustomDomain && (
            <Alert>
              <AlertDescription>
                Domínio personalizado do portal fica disponível a partir do
                plano Professional.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <StatusMetric
              label="URL atual do portal"
              value={payload.portalBaseUrl}
            />
            <StatusMetric
              label="Última verificação"
              value={formatDateTime(domain?.lastVerifiedAt ?? null)}
            />
            <StatusMetric
              label="Ativação"
              value={formatDateTime(domain?.activatedAt ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
          <CardDescription>{payload.statusSummary.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              createMutation.mutate()
            }}
          >
            <Field>
              <FieldLabel htmlFor="portal-domain-hostname">Hostname</FieldLabel>
              <Input
                id="portal-domain-hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder={domain?.hostname ?? 'portal.suaempresa.com.br'}
                disabled={!hasCustomDomain || createMutation.isPending}
              />
              <FieldDescription>
                Use apenas o hostname do portal. Exemplo:{' '}
                <code>portal.suaempresa.com.br</code>
              </FieldDescription>
            </Field>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={
                  !hasCustomDomain ||
                  !hostname.trim() ||
                  createMutation.isPending
                }
              >
                {domain ? 'Atualizar domínio' : 'Salvar domínio'}
              </Button>
            </div>
          </form>

          {domain ? (
            <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">DNS esperado</CardTitle>
                  <CardDescription>
                    Configure o registro TXT abaixo para liberar a verificação.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Hostname</p>
                    <p className="font-medium">{domain.hostname}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">TXT host</p>
                    <p className="font-mono text-sm">
                      {payload.statusSummary.diagnostics.host}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">TXT token</p>
                    <p className="font-mono text-sm break-all">
                      {payload.statusSummary.diagnostics.expectedValue}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Diagnóstico</CardTitle>
                  <CardDescription>
                    Estado atual de resolução e prontidão do domínio.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid gap-3 md:grid-cols-2">
                    <StatusMetric
                      label="Verificado em"
                      value={formatDateTime(domain.verifiedAt)}
                    />
                    <StatusMetric
                      label="Pode ativar"
                      value={payload.statusSummary.canActivate ? 'Sim' : 'Não'}
                    />
                  </div>

                  <div>
                    <p className="text-muted-foreground">TXT observados</p>
                    {payload.statusSummary.diagnostics.observedValues.length >
                    0 ? (
                      <div className="mt-2 space-y-2">
                        {payload.statusSummary.diagnostics.observedValues.map(
                          (value) => (
                            <div
                              key={value}
                              className="rounded-md border px-3 py-2 font-mono text-xs break-all"
                            >
                              {value}
                            </div>
                          ),
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-muted-foreground">
                        Nenhum TXT encontrado até o momento.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => verifyMutation.mutate()}
                      disabled={!hasCustomDomain || verifyMutation.isPending}
                    >
                      Verificar DNS
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => activateMutation.mutate()}
                      disabled={
                        !hasCustomDomain ||
                        !payload.statusSummary.canActivate ||
                        activateMutation.isPending
                      }
                    >
                      Ativar domínio
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                    >
                      Remover
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum domínio configurado. Salve um hostname para iniciar o
                lifecycle do portal.
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-medium">{value}</p>
    </div>
  )
}

function PortalDomainSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  )
}
