import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import type { EmailDomainResponse } from '@calibra-facil/client-runtime'

import { usePlanAccess } from '@/hooks/use-plan-access'
import { calibraApi } from '@/utils/api'
import {
  normalizeEmailDnsRecords,
  suggestSendingSubdomain,
} from '@/features/settings/email-domain-records'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

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

export function EmailDomainSettingsPage() {
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const domainQuery = useEmailDomainData()

  const [hostname, setHostname] = useState('')
  const [fromLocalPart, setFromLocalPart] = useState<string | null>(null)
  const savedDomain = domainQuery.data?.domain
  const sendingHostname = savedDomain?.hostname ?? hostname
  const sendingLocalPart =
    fromLocalPart ?? savedDomain?.fromAddress.split('@')[0] ?? 'contato'

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['email-domain'] })
  }

  const createMutation = useMutation({
    mutationFn: async () =>
      calibraApi.emailDomains.create({
        hostname: sendingHostname,
        fromLocalPart: sendingLocalPart,
      }),
    onSuccess: async () => {
      toast.success(
        savedDomain
          ? 'Remetente salvo'
          : 'Registros gerados. Publique-os no seu DNS e verifique.',
      )
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar remetente',
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
      setHostname('')
      setFromLocalPart(null)
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
  const dnsRecords = normalizeEmailDnsRecords(domain?.dnsRecords)
  const subdomainSuggestion = domain ? null : suggestSendingSubdomain(hostname)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Domínio de e-mail</CardTitle>
          <CardDescription>
            Envie os e-mails de OS, orçamentos e portal a partir do domínio do
            seu laboratório. Você publica alguns registros de DNS e pronto, sem
            criar conta em outro serviço. Sem configuração, tudo continua saindo
            do remetente padrão da plataforma.
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
                  ? 'Serviço de envio indisponível'
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
                  : 'Remetente padrão da plataforma'
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
                ? 'O acesso ao serviço de envio foi recusado. Contate o suporte.'
                : 'O serviço de envio atingiu o limite de uso. Aguarde e tente novamente.'}
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
            {domain ? 'Domínio configurado' : 'Configurar envio'}
          </CardTitle>
          <CardDescription>
            Use um subdomínio dedicado, como certificados.seulaboratorio.com.br.
            O CalibraFácil configura o serviço de envio e você publica os
            registros DNS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Informe o domínio e o endereço do remetente para gerar os
              registros.
            </li>
            <li>
              Publique os registros no serviço onde você gerencia o DNS do
              laboratório.
            </li>
            <li>
              Selecione Verificar novamente. Após a confirmação, selecione
              Ativar envio.
            </li>
          </ol>
          {domain && (
            <p className="text-sm text-muted-foreground">
              Para trocar de domínio, remova a configuração atual abaixo e
              configure o novo domínio.
              {domain.mode === 'byok' &&
                ' Sua configuração anterior continua funcionando. A remoção não exclui o domínio da sua conta Resend.'}
            </p>
          )}

          {domain?.mode !== 'byok' && (
            <form
              className="space-y-4 rounded-lg border p-4"
              onSubmit={(event) => {
                event.preventDefault()
                createMutation.mutate()
              }}
            >
              <Field>
                <FieldLabel htmlFor="email-domain-hostname">
                  Domínio de envio
                </FieldLabel>
                <Input
                  id="email-domain-hostname"
                  value={sendingHostname}
                  onChange={(event) => setHostname(event.target.value)}
                  placeholder="certificados.seulaboratorio.com.br"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={
                    Boolean(domain) ||
                    !hasEntitlement ||
                    createMutation.isPending
                  }
                />
                <FieldDescription>
                  Use um subdomínio dedicado ao envio. Assim a reputação dos
                  e-mails do sistema fica separada da do domínio que a sua
                  equipe já usa no dia a dia.
                </FieldDescription>
                {subdomainSuggestion && (
                  <FieldDescription className="text-amber-700 dark:text-amber-400">
                    Você digitou o domínio principal.{' '}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => setHostname(subdomainSuggestion)}
                    >
                      Usar {subdomainSuggestion}
                    </button>
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="email-domain-local-part">
                  Endereço do remetente
                </FieldLabel>
                <div className="flex items-center gap-1">
                  <Input
                    id="email-domain-local-part"
                    value={sendingLocalPart}
                    onChange={(event) => setFromLocalPart(event.target.value)}
                    className="max-w-40"
                    disabled={createMutation.isPending}
                  />
                  <span className="text-sm text-muted-foreground">
                    @{sendingHostname.trim() || 'seu-dominio'}
                  </span>
                </div>
                <FieldDescription>
                  Os clientes verão este endereço e o nome do laboratório como
                  remetente. As respostas vão para o e-mail de contato da
                  organização, exibido acima.
                </FieldDescription>
              </Field>

              <Button
                type="submit"
                disabled={
                  !hasEntitlement ||
                  !sendingHostname.trim() ||
                  !sendingLocalPart.trim() ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending
                  ? 'Salvando'
                  : domain
                    ? 'Salvar remetente'
                    : 'Gerar registros DNS'}
              </Button>
            </form>
          )}

          {dnsRecords.length > 0 && (
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">
                  Publique estes registros no seu DNS
                </p>
                <p className="text-sm text-muted-foreground">
                  São gerados pelo provedor de envio. Copie exatamente como
                  estão, sem alterar nada. A propagação costuma levar de alguns
                  minutos a algumas horas.
                </p>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Tipo</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead className="w-20">Prioridade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dnsRecords.map((record) => (
                      <TableRow key={`${record.type}-${record.name}`}>
                        <TableCell className="font-mono text-xs">
                          {record.type}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-all">
                          {record.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-all">
                          {record.value}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {record.priority ?? '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Alert>
                <AlertDescription>
                  Se o seu DNS recusar algum registro por conflito de nome,
                  confira se já existe outro registro com o mesmo Nome. Um host
                  não pode ter um CNAME junto de outros tipos de registro.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {domain && (
        <Card>
          <CardHeader>
            <CardTitle>Configuração atual</CardTitle>
            <CardDescription>
              Confira a verificação do domínio e ative ou remova o envio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusMetric label="Domínio" value={domain.hostname} />
              <StatusMetric label="Remetente" value={domain.fromAddress} />
              {domain.mode === 'byok' && (
                <StatusMetric
                  label="Chave de API"
                  value={domain.apiKeyMasked}
                />
              )}
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
