import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SsoVerificationRecord } from '@calibra-facil/client-runtime'
import {
  Cancel01Icon,
  CheckmarkBadge01Icon,
  LinkSquare02Icon,
  SecurityCheckIcon,
  Shield01Icon,
  SmartPhone01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { usePlanAccess } from '@/hooks/use-plan-access'
import { useSettings } from '@/contexts/settings-context'
import { calibraApi, resolveCloudApiUrl } from '@/utils/api'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useApiKeysData, useSsoSettingsData } from '@/features/settings/queries'

type VerificationRecord = SsoVerificationRecord

export function AuthenticationSettingsPage() {
  const { user, isLoading } = useSettings()
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()

  if (isLoading || isLoadingOrg) {
    return <AuthenticationSkeleton />
  }

  const organizationType =
    activeOrg && 'type' in activeOrg && typeof activeOrg.type === 'string'
      ? activeOrg.type
      : 'LAB'

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h2 className="text-balance text-lg font-semibold tracking-tight">
          Autenticação
        </h2>
        <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
          Como você acessa sua conta e como a organização usa autenticação
          corporativa e chaves de API.
        </p>
      </div>

      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="Métodos de acesso"
          description="Como você faz login na sua conta."
        />
        <div className="mt-4 space-y-3">
          <AuthStatusRow
            icon={CheckmarkBadge01Icon}
            title="Senha"
            description="Faça login com email e senha"
            statusLabel="Ativo"
            statusVariant="default"
          />

          <AuthStatusRow
            icon={user?.emailVerified ? CheckmarkBadge01Icon : Cancel01Icon}
            title="Verificação de Email"
            description={user?.email ?? 'Email não disponível'}
            statusLabel={user?.emailVerified ? 'Verificado' : 'Pendente'}
            statusVariant={user?.emailVerified ? 'default' : 'secondary'}
            iconClassName={
              user?.emailVerified ? 'text-green-600' : 'text-yellow-600'
            }
          />
        </div>
      </Panel>

      {organizationType === 'LAB' ? (
        <>
          <SsoSettingsCard
            key={activeOrg?.id ?? 'no-org'}
            activeOrganizationKey={activeOrg?.id ?? null}
          />
          <ApiKeysCard />
        </>
      ) : (
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="SSO corporativo"
            description="O SSO está disponível apenas para organizações do tipo laboratório."
          />
        </Panel>
      )}
    </div>
  )
}

function ApiKeysCard() {
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const [name, setName] = useState('')
  const [latestSecret, setLatestSecret] = useState<string | null>(null)
  const apiReferenceUrl = resolveCloudApiUrl('/api/public/v2/reference')

  const apiKeysQuery = useApiKeysData()

  const createMutation = useMutation({
    mutationFn: () => calibraApi.apiKeys.create({ name }),
    onSuccess: async (data) => {
      setLatestSecret(data.secret)
      setName('')
      toast.success('API key criada')
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar API key',
      )
    },
  })

  const rotateMutation = useMutation({
    mutationFn: (id: string) => calibraApi.apiKeys.rotate(id),
    onSuccess: async (data) => {
      setLatestSecret(data.secret)
      toast.success('API key rotacionada')
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao rotacionar API key',
      )
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => calibraApi.apiKeys.revoke(id),
    onSuccess: async () => {
      toast.success('API key revogada')
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao revogar API key',
      )
    },
  })

  const hasApi = accessQuery.data?.hasApi ?? false
  const apiKeys = apiKeysQuery.data?.data ?? []

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        title="API keys"
        description="Crie chaves para integrar sistemas externos à API pública do laboratório."
        action={
          <Badge variant={hasApi ? 'default' : 'secondary'}>
            {accessQuery.data?.planName ?? 'Plano atual'}
          </Badge>
        }
      />
      <div className="mt-4 space-y-6">
        {!hasApi && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            O entitlement de API está disponível a partir do plano Professional.
          </div>
        )}

        {hasApi && (
          <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="font-medium">Referência da API</p>
              <p className="text-sm text-muted-foreground">
                A documentação técnica interativa da API fica disponível apenas
                para organizações com entitlement ativo e sessão válida.
              </p>
            </div>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={apiReferenceUrl}
                  target="_blank"
                  rel="noreferrer nofollow"
                />
              }
            >
              Abrir referência
            </Button>
          </div>
        )}

        {latestSecret && (
          <div className="rounded-lg border p-4">
            <p className="font-medium">Guarde esta chave agora</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Este segredo é exibido apenas uma vez.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {latestSecret}
            </pre>
          </div>
        )}

        <form
          className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          <Field className="flex-1">
            <FieldLabel htmlFor="apiKeyName">Nome da chave</FieldLabel>
            <Input
              id="apiKeyName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ERP principal"
              disabled={!hasApi || createMutation.isPending}
            />
            <FieldDescription>
              A chave nasce com escopos de leitura para clientes, ativos, ordens
              e certificados.
            </FieldDescription>
          </Field>
          <Button
            type="submit"
            disabled={!hasApi || !name.trim() || createMutation.isPending}
          >
            Criar API key
          </Button>
        </form>

        <div className="space-y-3">
          {apiKeys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nenhuma API key criada até o momento.
            </div>
          ) : (
            apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <p className="font-medium">{key.name}</p>
                  <p className="font-mono text-sm text-muted-foreground">
                    {key.keyPrefix}...
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Escopos: {key.scopes.join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Último uso:{' '}
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString('pt-BR')
                      : 'Nunca utilizada'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {key.revokedAt ? (
                    <Badge variant="secondary">Revogada</Badge>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => rotateMutation.mutate(key.id)}
                        disabled={!hasApi || rotateMutation.isPending}
                      >
                        Rotacionar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => revokeMutation.mutate(key.id)}
                        disabled={revokeMutation.isPending}
                      >
                        Revogar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  )
}

function AuthStatusRow({
  icon,
  title,
  description,
  statusLabel,
  statusVariant,
  iconClassName,
}: {
  icon: typeof CheckmarkBadge01Icon
  title: string
  description: string
  statusLabel: string
  statusVariant: 'default' | 'secondary'
  iconClassName?: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <HugeiconsIcon icon={icon} className={iconClassName ?? 'h-5 w-5'} />
        </div>
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Badge variant={statusVariant}>{statusLabel}</Badge>
    </div>
  )
}

function SsoSettingsCard({
  activeOrganizationKey,
}: {
  activeOrganizationKey: string | null
}) {
  const queryClient = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [issuer, setIssuer] = useState('')
  const [domain, setDomain] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [scopes, setScopes] = useState('openid, email, profile')
  const [verificationRecord, setVerificationRecord] =
    useState<VerificationRecord | null>(null)

  const ssoQuery = useSsoSettingsData({
    organizationKey: activeOrganizationKey,
    enabled: Boolean(activeOrganizationKey),
  })

  const createProviderMutation = useMutation({
    mutationFn: async () => {
      const parsedScopes = scopes
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)

      return calibraApi.sso.createProvider({
        providerId,
        issuer,
        domain,
        clientId,
        clientSecret,
        scopes: parsedScopes,
      })
    },
    onSuccess: async (data) => {
      setVerificationRecord(data.verificationRecord)
      setClientSecret('')
      toast.success('Provedor SSO registrado')
      await queryClient.invalidateQueries({
        queryKey: ['sso-settings', activeOrganizationKey ?? 'no-org'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao registrar provedor SSO',
      )
    },
  })

  const requestVerificationMutation = useMutation({
    mutationFn: (targetProviderId: string) =>
      calibraApi.sso.requestDomainVerification(targetProviderId),
    onSuccess: (data) => {
      setVerificationRecord(data.verificationRecord)
      toast.success('Novo token DNS gerado')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao gerar token DNS',
      )
    },
  })

  const verifyDomainMutation = useMutation({
    mutationFn: (targetProviderId: string) =>
      calibraApi.sso.verifyDomain(targetProviderId),
    onSuccess: async () => {
      setVerificationRecord(null)
      toast.success('Domínio verificado com sucesso')
      await queryClient.invalidateQueries({
        queryKey: ['sso-settings', activeOrganizationKey ?? 'no-org'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao verificar domínio',
      )
    },
  })

  const deleteProviderMutation = useMutation({
    mutationFn: (targetProviderId: string) =>
      calibraApi.sso.deleteProvider(targetProviderId),
    onSuccess: async () => {
      setVerificationRecord(null)
      setIssuer('')
      setDomain('')
      setClientId('')
      setClientSecret('')
      toast.success('Provedor SSO removido')
      await queryClient.invalidateQueries({
        queryKey: ['sso-settings', activeOrganizationKey ?? 'no-org'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao remover provedor SSO',
      )
    },
  })

  if (!activeOrganizationKey) {
    return (
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="SSO corporativo"
          description="Selecione uma organização para configurar autenticação corporativa."
        />
      </Panel>
    )
  }

  if (ssoQuery.isLoading) {
    return <SsoSkeleton />
  }

  if (ssoQuery.isError) {
    return (
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="SSO corporativo"
          description={
            ssoQuery.error instanceof Error
              ? ssoQuery.error.message
              : 'Falha ao carregar configuração SSO.'
          }
        />
      </Panel>
    )
  }

  const data = ssoQuery.data
  if (!data) {
    return <SsoSkeleton />
  }

  const provider = data.provider
  const canManage = data.access.canManage
  const hasSso = data.billing.hasSso

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        title="SSO corporativo"
        description="Login corporativo via OIDC para o dashboard do laboratório."
        action={
          <div className="flex flex-wrap gap-2">
            <Badge variant={hasSso ? 'default' : 'secondary'}>
              {data.billing.planName}
            </Badge>
            <Badge variant={provider?.domainVerified ? 'default' : 'secondary'}>
              {provider?.domainVerified ? 'Domínio verificado' : 'Pendente'}
            </Badge>
          </div>
        }
      />
      <div className="mt-4 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatusTile
            icon={Shield01Icon}
            title="Plano"
            value={hasSso ? 'Enterprise ativo' : 'Sem entitlement SSO'}
            description={
              hasSso
                ? 'SSO liberado para esta organização.'
                : 'A autenticação SSO está disponível apenas no plano Enterprise.'
            }
          />
          <StatusTile
            icon={SecurityCheckIcon}
            title="Relacionamento"
            value={canManage ? 'Owner pode gerenciar' : 'Somente leitura'}
            description={
              canManage
                ? 'Cadastro, verificação e remoção do provedor estão liberados.'
                : 'Apenas o owner da organização pode alterar a configuração SSO.'
            }
          />
          <StatusTile
            icon={LinkSquare02Icon}
            title="Callback"
            value={provider?.redirectURI ?? 'Aguardando configuração'}
            description="Use esta URL no provedor OIDC como redirect/callback URI."
          />
        </div>

        {!hasSso && !provider && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Esta organização ainda não possui entitlement de SSO. Faça upgrade
            para Enterprise antes de cadastrar um provedor.
          </div>
        )}

        {!canManage && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Você pode consultar o estado atual do SSO, mas somente o owner da
            organização pode cadastrar, verificar ou remover o provedor.
          </div>
        )}

        {provider ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{provider.providerId}</p>
                  <p className="text-sm text-muted-foreground">
                    {provider.issuer}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{provider.domainHost}</Badge>
                  <Badge variant="secondary">
                    {provider.oidcConfig?.clientIdLastFour
                      ? `Client ID ••••${provider.oidcConfig.clientIdLastFour}`
                      : 'OIDC'}
                  </Badge>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="grid gap-4 md:grid-cols-2">
                <ReadonlyField
                  label="Redirect URI"
                  value={provider.redirectURI}
                />
                <ReadonlyField
                  label="Discovery endpoint"
                  value={
                    provider.oidcConfig?.discoveryEndpoint ?? 'Não disponível'
                  }
                />
                <ReadonlyField
                  label="Scopes"
                  value={
                    (provider.oidcConfig?.scopes ?? []).join(', ') ||
                    'openid, email, profile'
                  }
                />
                <ReadonlyField
                  label="Token endpoint auth"
                  value={
                    provider.oidcConfig?.tokenEndpointAuthentication ??
                    'client_secret_basic'
                  }
                />
              </div>
            </div>

            {verificationRecord && !provider.domainVerified && (
              <DnsRecordCard verificationRecord={verificationRecord} />
            )}

            {!provider.domainVerified && (
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() =>
                    verifyDomainMutation.mutate(provider.providerId)
                  }
                  disabled={!canManage || verifyDomainMutation.isPending}
                >
                  Verificar domínio
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    requestVerificationMutation.mutate(provider.providerId)
                  }
                  disabled={!canManage || requestVerificationMutation.isPending}
                >
                  Reemitir token DNS
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !data.access.canDelete ||
                        deleteProviderMutation.isPending
                      }
                    />
                  }
                >
                  Remover provedor
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover provedor SSO?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação remove a configuração OIDC da organização. Novos
                      logins via SSO serão bloqueados imediatamente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        deleteProviderMutation.mutate(provider.providerId)
                      }
                    >
                      Remover
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              createProviderMutation.mutate()
            }}
          >
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="providerId">Provider ID</FieldLabel>
                <Input
                  id="providerId"
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value)}
                  placeholder="laboratorio-oidc"
                  disabled={!canManage || !hasSso}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="domain">Domínio corporativo</FieldLabel>
                <Input
                  id="domain"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="laboratorio.com.br"
                  disabled={!canManage || !hasSso}
                  required
                />
                <FieldDescription>
                  Pode ser informado como domínio simples. O sistema normaliza
                  para HTTPS.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="issuer">Issuer OIDC</FieldLabel>
                <Input
                  id="issuer"
                  value={issuer}
                  onChange={(event) => setIssuer(event.target.value)}
                  placeholder="https://idp.empresa.com/realms/lab"
                  disabled={!canManage || !hasSso}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="clientId">Client ID</FieldLabel>
                <Input
                  id="clientId"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  disabled={!canManage || !hasSso}
                  required
                />
              </Field>
            </FieldGroup>

            <FieldGroup className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="clientSecret">Client Secret</FieldLabel>
                <Input
                  id="clientSecret"
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  disabled={!canManage || !hasSso}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scopes">Scopes OIDC</FieldLabel>
                <Textarea
                  id="scopes"
                  value={scopes}
                  onChange={(event) => setScopes(event.target.value)}
                  disabled={!canManage || !hasSso}
                  rows={3}
                />
                <FieldDescription>
                  Informe os scopes separados por vírgula. O padrão é{' '}
                  <code>openid, email, profile</code>.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                disabled={
                  !canManage || !hasSso || createProviderMutation.isPending
                }
              >
                Configurar SSO
              </Button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  )
}

function StatusTile({
  icon,
  title,
  value,
  description,
}: {
  icon: typeof Shield01Icon
  title: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
        <HugeiconsIcon icon={icon} className="h-5 w-5" />
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 break-all font-medium">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-sm">{value}</p>
    </div>
  )
}

function DnsRecordCard({
  verificationRecord,
}: {
  verificationRecord: VerificationRecord
}) {
  return (
    <div className="rounded-lg border border-dashed p-4">
      <div className="mb-3 flex items-center gap-2">
        <HugeiconsIcon icon={SmartPhone01Icon} className="h-4 w-4" />
        <p className="font-medium">Registro DNS para verificação</p>
      </div>
      <div className="space-y-3 text-sm">
        <ReadonlyField label="Tipo" value={verificationRecord.type} />
        <ReadonlyField label="Host" value={verificationRecord.host} />
        <ReadonlyField label="Valor" value={verificationRecord.value} />
      </div>
    </div>
  )
}

function AuthenticationSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-56" />
      <Panel className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-5 w-44" />
        {[1, 2].map((item) => (
          <div
            key={item}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </Panel>
      <SsoSkeleton />
    </div>
  )
}

function SsoSkeleton() {
  return (
    <Panel className="space-y-4 p-5 sm:p-6">
      <Skeleton className="h-5 w-40" />
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="rounded-lg border p-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="mt-4 h-4 w-24" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
          </div>
        ))}
      </div>
      <Skeleton className="h-44 w-full rounded-lg" />
    </Panel>
  )
}
