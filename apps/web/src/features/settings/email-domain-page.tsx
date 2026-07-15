import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import type { EmailDomainResponse } from '@calibra-facil/client-runtime'

import { usePlanAccess } from '@/hooks/use-plan-access'
import { calibraApi } from '@/utils/api'
import { useEmailDomainData } from '@/features/settings/queries'
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

type ValidatedDomain = { id: string; name: string; status: string }

function formatDateTime(value: string | Date | null) {
  if (!value) return 'Ainda não disponível'

  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function statusVariant(status: EmailDomainResponse['statusSummary']['status']) {
  switch (status) {
    case 'active':
      return 'default' as const
    case 'verified':
      return 'secondary' as const
    default:
      return 'outline' as const
  }
}

function statusLabel(status: EmailDomainResponse['statusSummary']['status']) {
  switch (status) {
    case 'not_configured':
      return 'Não configurado'
    case 'waiting_verification':
      return 'Aguardando verificação'
    case 'verified':
      return 'Verificado'
    case 'active':
      return 'Ativo'
  }
}

function resendStatusLabel(status: string) {
  switch (status) {
    case 'verified':
      return 'Verificado'
    case 'pending':
      return 'Pendente'
    case 'failed':
    case 'partially_failed':
      return 'Falhou'
    default:
      return 'Não verificado'
  }
}

export function EmailDomainSettingsPage() {
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const domainQuery = useEmailDomainData()

  const [apiKey, setApiKey] = useState('')
  const [validatedDomains, setValidatedDomains] = useState<
    ValidatedDomain[] | null
  >(null)
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null)
  const [fromLocalPart, setFromLocalPart] = useState('contato')
  const [rotateKeyValue, setRotateKeyValue] = useState('')

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['email-domain'] })
  }

  const validateKeyMutation = useMutation({
    mutationFn: async () => calibraApi.emailDomains.validateKey({ apiKey }),
    onSuccess: (result) => {
      const domains = result.domains ?? []
      setValidatedDomains(domains)
      const firstVerified = domains.find((d) => d.status === 'verified')
      setSelectedDomainId(firstVerified?.id ?? domains[0]?.id ?? null)
      if (domains.length === 0) {
        toast.info(
          'Chave válida, mas a conta ainda não tem domínios. Adicione um domínio no painel do Resend.',
        )
      } else {
        toast.success('Chave validada. Escolha o domínio de envio.')
      }
    },
    onError: (error) => {
      setValidatedDomains(null)
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar a chave',
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDomainId) throw new Error('Escolha um domínio')
      return calibraApi.emailDomains.create({
        apiKey,
        resendDomainId: selectedDomainId,
        fromLocalPart,
      })
    },
    onSuccess: async () => {
      setApiKey('')
      setValidatedDomains(null)
      setSelectedDomainId(null)
      toast.success('Remetente salvo. Ative o envio quando estiver pronto.')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar remetente',
      )
    },
  })

  const rotateKeyMutation = useMutation({
    mutationFn: async () =>
      calibraApi.emailDomains.rotateKey({ apiKey: rotateKeyValue }),
    onSuccess: async () => {
      setRotateKeyValue('')
      toast.success('Chave atualizada')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar a chave',
      )
    },
  })

  const verifyMutation = useMutation({
    mutationFn: async () => calibraApi.emailDomains.verify(),
    onSuccess: async (result) => {
      if (result.statusSummary.status === 'waiting_verification') {
        toast.info('O Resend ainda não confirmou os registros DNS.')
      } else {
        toast.success('Verificação atualizada')
      }
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao verificar domínio',
      )
    },
  })

  const activateMutation = useMutation({
    mutationFn: async () => calibraApi.emailDomains.activate(),
    onSuccess: async () => {
      toast.success('Envio pelo seu domínio ativado')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao ativar domínio',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => calibraApi.emailDomains.delete(),
    onSuccess: async () => {
      toast.success(
        'Configuração removida. Os e-mails voltam ao remetente padrão.',
      )
      await refresh()
    },
    onError: () => {
      toast.error('Falha ao remover configuração')
    },
  })

  if (domainQuery.isLoading || accessQuery.isLoading) {
    return <EmailDomainSkeleton />
  }

  if (domainQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Domínio de e-mail</CardTitle>
          <CardDescription>
            {domainQuery.error instanceof Error
              ? domainQuery.error.message
              : 'Falha ao carregar domínio de e-mail'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const payload = domainQuery.data
  if (!payload) {
    return <EmailDomainSkeleton />
  }

  const hasEntitlement =
    accessQuery.data?.entitlements.includes('email_sender_domain') ?? false
  const domain = payload.domain
  const keyHealth = payload.statusSummary.keyHealth
  const selectedDomain =
    validatedDomains?.find((d) => d.id === selectedDomainId) ?? null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Domínio de e-mail</CardTitle>
          <CardDescription>
            Envie os e-mails de OS, orçamentos e portal a partir do domínio do
            seu laboratório, com a sua própria conta Resend. Sem configuração,
            tudo continua saindo de calibrafacil.com.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(payload.statusSummary.status)}>
              {statusLabel(payload.statusSummary.status)}
            </Badge>
            {keyHealth.status !== 'ok' && (
              <Badge variant="destructive">
                {keyHealth.status === 'invalid'
                  ? 'Chave inválida'
                  : 'Limite de envio atingido'}
              </Badge>
            )}
            {!hasEntitlement && <Badge variant="outline">Standard+</Badge>}
          </div>

          {!hasEntitlement && (
            <Alert>
              <AlertDescription>
                O envio pelo seu próprio domínio fica disponível a partir do
                plano Standard.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatusMetric
              label="Remetente atual"
              value={
                payload.statusSummary.status === 'active' && domain
                  ? domain.fromAddress
                  : 'noreply@calibrafacil.com'
              }
            />
            <StatusMetric
              label="Respostas vão para"
              value={payload.replyToEmail ?? 'Não configurado'}
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

          {!payload.replyToEmail && (
            <Alert variant="destructive">
              <AlertDescription>
                Defina o e-mail de contato do laboratório em{' '}
                <Link
                  to="/dashboard/settings/organization"
                  className="font-medium underline"
                >
                  identidade da organização
                </Link>{' '}
                para receber as respostas dos seus clientes.
              </AlertDescription>
            </Alert>
          )}

          <p className="text-sm text-muted-foreground">
            {payload.statusSummary.message}
          </p>
        </CardContent>
      </Card>

      {keyHealth.status !== 'ok' && domain && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1">
            <span className="font-medium">
              {keyHealth.status === 'invalid'
                ? 'A chave do Resend foi recusada. Os e-mails estão saindo pelo remetente padrão da plataforma.'
                : 'A conta do Resend atingiu o limite de envio. Os e-mails excedentes saem pelo remetente padrão da plataforma.'}
            </span>
            {keyHealth.lastError && (
              <span className="block font-mono text-xs break-all">
                {keyHealth.lastError}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {domain ? 'Trocar domínio ou conta' : 'Configurar envio'}
          </CardTitle>
          <CardDescription>
            O laboratório usa a própria conta Resend. Recomendamos um subdomínio
            dedicado, como <code>mail.suaempresa.com.br</code>, para proteger a
            reputação do seu e-mail principal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Crie uma conta gratuita em{' '}
              <a
                href="https://resend.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                resend.com
              </a>
              .
            </li>
            <li>
              No painel do Resend, adicione o subdomínio de envio e conclua a
              verificação DNS (DKIM e SPF).
            </li>
            <li>
              Gere uma chave de API com acesso total e cole abaixo. Ela fica
              criptografada e nunca é exibida novamente.
            </li>
          </ol>

          <form
            className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              validateKeyMutation.mutate()
            }}
          >
            <Field>
              <FieldLabel htmlFor="email-domain-api-key">
                Chave de API do Resend
              </FieldLabel>
              <Input
                id="email-domain-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="re_..."
                autoComplete="off"
                disabled={!hasEntitlement || validateKeyMutation.isPending}
              />
              <FieldDescription>
                Validamos a chave direto no Resend antes de salvar qualquer
                coisa.
              </FieldDescription>
            </Field>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={
                  !hasEntitlement ||
                  !apiKey.trim() ||
                  validateKeyMutation.isPending
                }
              >
                Validar chave
              </Button>
            </div>
          </form>

          {validatedDomains && validatedDomains.length > 0 && (
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Domínios da conta</p>
                <p className="text-sm text-muted-foreground">
                  Escolha o domínio verificado que vai assinar os envios.
                </p>
              </div>
              <div className="grid gap-2">
                {validatedDomains.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedDomainId(item.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedDomainId === item.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="font-mono">{item.name}</span>
                    <Badge
                      variant={
                        item.status === 'verified' ? 'secondary' : 'outline'
                      }
                    >
                      {resendStatusLabel(item.status)}
                    </Badge>
                  </button>
                ))}
              </div>

              <form
                className="grid gap-4 lg:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault()
                  createMutation.mutate()
                }}
              >
                <Field>
                  <FieldLabel htmlFor="email-domain-local-part">
                    Endereço do remetente
                  </FieldLabel>
                  <div className="flex items-center gap-1">
                    <Input
                      id="email-domain-local-part"
                      value={fromLocalPart}
                      onChange={(event) => setFromLocalPart(event.target.value)}
                      className="max-w-40"
                      disabled={createMutation.isPending}
                    />
                    <span className="text-sm text-muted-foreground">
                      @{selectedDomain?.name ?? 'seu-dominio'}
                    </span>
                  </div>
                  <FieldDescription>
                    Os clientes verão este endereço como remetente. O nome de
                    exibição é o nome do laboratório.
                  </FieldDescription>
                </Field>
                <div className="flex items-end">
                  <Button
                    type="submit"
                    disabled={
                      !selectedDomainId ||
                      !fromLocalPart.trim() ||
                      createMutation.isPending
                    }
                  >
                    Salvar remetente
                  </Button>
                </div>
              </form>

              {selectedDomain && selectedDomain.status !== 'verified' && (
                <Alert>
                  <AlertDescription>
                    Este domínio ainda não foi verificado pelo Resend. Você pode
                    salvá-lo, mas o envio só é liberado depois da verificação.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {domain && (
        <Card>
          <CardHeader>
            <CardTitle>Configuração atual</CardTitle>
            <CardDescription>
              Estado do domínio, saúde da chave e ações de ciclo de vida.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusMetric label="Domínio" value={domain.hostname} />
              <StatusMetric label="Remetente" value={domain.fromAddress} />
              <StatusMetric label="Chave de API" value={domain.apiKeyMasked} />
              <StatusMetric
                label="Verificado em"
                value={formatDateTime(domain.verifiedAt)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => verifyMutation.mutate()}
                disabled={!hasEntitlement || verifyMutation.isPending}
              >
                Verificar novamente
              </Button>
              <Button
                type="button"
                onClick={() => activateMutation.mutate()}
                disabled={
                  !hasEntitlement ||
                  !payload.statusSummary.canActivate ||
                  activateMutation.isPending
                }
              >
                Ativar envio
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

            <form
              className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault()
                rotateKeyMutation.mutate()
              }}
            >
              <Field>
                <FieldLabel htmlFor="email-domain-rotate-key">
                  Trocar chave de API
                </FieldLabel>
                <Input
                  id="email-domain-rotate-key"
                  type="password"
                  value={rotateKeyValue}
                  onChange={(event) => setRotateKeyValue(event.target.value)}
                  placeholder="re_..."
                  autoComplete="off"
                  disabled={!hasEntitlement || rotateKeyMutation.isPending}
                />
                <FieldDescription>
                  Use quando a chave for revogada ou girada no Resend. A nova
                  chave precisa alcançar o mesmo domínio.
                </FieldDescription>
              </Field>
              <div className="flex items-end">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    !hasEntitlement ||
                    !rotateKeyValue.trim() ||
                    rotateKeyMutation.isPending
                  }
                >
                  Atualizar chave
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
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

function EmailDomainSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  )
}
