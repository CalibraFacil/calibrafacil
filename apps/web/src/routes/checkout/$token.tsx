import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  Copy01Icon,
  CreditCardIcon,
  CustomerSupportIcon,
  HelpCircleIcon,
  Invoice01Icon,
  QrCodeIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { BrandLockup } from '@/components/brand'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { PublicCheckoutPresentation } from '@/features/public/types'
import {
  usePublicCheckoutSnapshotData,
  usePublicCheckoutStatusData,
} from '@/features/public/queries'
import type {
  CheckoutState,
  PublicCheckoutStartResponse,
} from '@/features/public/types'
import { cn } from '@/lib/utils'
import { calibraApi } from '@/utils/api'

type ProviderOutcome = 'success' | 'cancel' | 'expired'

type CheckoutSearch = {
  providerOutcome?: ProviderOutcome
}

const METHOD_COPY = {
  PIX: {
    title: 'Pagamento por Pix',
    body: 'O pagamento é concluído aqui na página da CalibraFácil com QR Code e código copia e cola.',
    button: 'Gerar Pix',
  },
  BOLETO: {
    title: 'Pagamento por boleto',
    body: 'Emitimos o boleto e mantemos o acompanhamento do status por aqui. A abertura do PDF acontece no ambiente do provedor.',
    button: 'Gerar boleto',
  },
  CREDIT_CARD: {
    title: 'Cartão de crédito',
    body: 'Você continuará em um ambiente seguro do Asaas para inserir os dados do cartão e concluir o pagamento.',
    button: 'Continuar para o pagamento',
  },
} as const

const STATE_LABELS: Record<CheckoutState, string> = {
  INVALID: 'Link inválido',
  EXPIRED: 'Oferta expirada',
  REVOKED: 'Link revogado',
  AWAITING_PAYMENT: 'Aguardando pagamento',
  PIX_READY: 'Pix disponível',
  BOLETO_READY: 'Boleto disponível',
  PAID: 'Pagamento confirmado',
  OVERDUE: 'Pagamento em atraso',
  REFUNDED: 'Pagamento devolvido',
  CANCELED: 'Oferta cancelada',
}

const STATE_BADGE_CLASS: Record<CheckoutState, string> = {
  INVALID: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
  EXPIRED:
    'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  REVOKED: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
  AWAITING_PAYMENT:
    'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  PIX_READY:
    'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  BOLETO_READY:
    'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PAID: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  OVERDUE:
    'border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  REFUNDED:
    'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  CANCELED:
    'border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
}

function formatPhone(value: string | null | undefined): string | null {
  if (!value) return null

  const digits = value.replace(/\D/g, '')
  const localDigits =
    digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  const trimmed = localDigits.slice(0, 11)

  if (trimmed.length < 10) {
    return value
  }

  if (trimmed.length <= 10) {
    return trimmed
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }

  return trimmed
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2')
}

export const Route = createFileRoute('/checkout/$token')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    providerOutcome:
      search.providerOutcome === 'success' ||
      search.providerOutcome === 'cancel' ||
      search.providerOutcome === 'expired'
        ? search.providerOutcome
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: 'Checkout comercial | CalibraFácil' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  component: PublicCheckoutPage,
})

function PublicCheckoutPage() {
  const { token } = Route.useParams()
  const { providerOutcome } = Route.useSearch()
  const queryClient = useQueryClient()
  const [copiedPix, setCopiedPix] = useState(false)
  const [copiedBoleto, setCopiedBoleto] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const snapshotQuery = usePublicCheckoutSnapshotData(token)

  const effectiveSnapshot = snapshotQuery.data
  const shouldPoll =
    effectiveSnapshot?.state === 'PIX_READY' ||
    effectiveSnapshot?.state === 'BOLETO_READY' ||
    effectiveSnapshot?.state === 'AWAITING_PAYMENT' ||
    Boolean(providerOutcome)

  const statusQuery = usePublicCheckoutStatusData({
    token,
    enabled: shouldPoll,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.state === 'INVALID') return false
      if (
        data.state === 'PAID' ||
        data.state === 'EXPIRED' ||
        data.state === 'REVOKED' ||
        data.state === 'CANCELED' ||
        data.state === 'REFUNDED' ||
        data.state === 'OVERDUE'
      ) {
        return false
      }

      const currentMethod = effectiveSnapshot?.offer?.paymentMethod
      return currentMethod === 'BOLETO' ? 30000 : 5000
    },
  })

  const startMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.publicCheckout.start<PublicCheckoutStartResponse>(token)
    },
    onMutate: () => {
      setStartError(null)
    },
    onSuccess: async (payload) => {
      if (payload.type === 'REDIRECT') {
        window.location.assign(payload.providerUrl)
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['public-commercial-checkout', token, 'snapshot'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['public-commercial-checkout', token, 'status'],
        }),
      ])
    },
    onError: (error) => {
      setStartError(
        error instanceof Error ? error.message : 'Falha ao iniciar o pagamento',
      )
    },
  })

  const liveState =
    statusQuery.data && statusQuery.data.state !== 'INVALID'
      ? statusQuery.data.state
      : (effectiveSnapshot?.state ?? 'AWAITING_PAYMENT')

  const livePresentation =
    statusQuery.data && statusQuery.data.state !== 'INVALID'
      ? statusQuery.data.presentation
      : (effectiveSnapshot?.presentation ?? null)

  const offer = effectiveSnapshot?.offer

  async function copyText(
    value: string | null | undefined,
    kind: 'pix' | 'boleto',
  ) {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      if (kind === 'pix') {
        setCopiedPix(true)
        setTimeout(() => setCopiedPix(false), 2000)
      } else {
        setCopiedBoleto(true)
        setTimeout(() => setCopiedBoleto(false), 2000)
      }
      toast.success('Texto copiado')
    } catch {
      toast.error('Falha ao copiar')
    }
  }

  if (snapshotQuery.isLoading) {
    return <CheckoutLoadingShell />
  }

  if (snapshotQuery.isError || !effectiveSnapshot) {
    return (
      <CheckoutFrame>
        <CenteredStateCard
          eyebrow="Checkout comercial"
          title="Não foi possível carregar a oferta"
          description="Tente abrir o link novamente em alguns instantes. Se o problema continuar, peça um novo link ao time comercial."
        />
      </CheckoutFrame>
    )
  }

  if (effectiveSnapshot.state === 'INVALID' || !offer) {
    return (
      <CheckoutFrame>
        <CenteredStateCard
          eyebrow="Link inválido"
          title="Este link não está disponível"
          description="O endereço pode estar incompleto, expirado ou já ter sido substituído por um novo envio."
        />
      </CheckoutFrame>
    )
  }

  const methodCopy = METHOD_COPY[offer.paymentMethod]
  const showTerminalState =
    liveState === 'EXPIRED' ||
    liveState === 'REVOKED' ||
    liveState === 'PAID' ||
    liveState === 'OVERDUE' ||
    liveState === 'REFUNDED' ||
    liveState === 'CANCELED'

  return (
    <CheckoutFrame>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <section className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)] md:p-8">
              <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.14),transparent_55%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.12),transparent_45%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.18),transparent_55%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.16),transparent_45%)]" />
              <div className="relative flex flex-col gap-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <Badge
                      variant="outline"
                      className="border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    >
                      Proposta comercial emitida
                    </Badge>
                    <div className="space-y-2">
                      <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                        Checkout comercial da {offer.seller.name}
                      </h1>
                      <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                        Confira a proposta negociada, o vencimento e o meio de
                        pagamento escolhido antes de prosseguir.
                      </p>
                    </div>
                  </div>
                  <StatusBadge state={liveState} />
                </div>

                {providerOutcome ? (
                  <OutcomeHint outcome={providerOutcome} />
                ) : null}

                <div className="grid gap-4 md:grid-cols-3">
                  <InfoPill
                    icon={Calendar03Icon}
                    label="Vencimento"
                    value={formatDate(offer.dueDate)}
                  />
                  <InfoPill
                    icon={Calendar03Icon}
                    label="Expiração do link"
                    value={formatDate(offer.offerExpiresAt)}
                  />
                  <InfoPill
                    icon={paymentMethodIcon(offer.paymentMethod)}
                    label="Meio de pagamento"
                    value={paymentMethodLabel(offer.paymentMethod)}
                  />
                </div>

                {offer.customerVisibleDescription ? (
                  <div className="rounded-2xl border border-border/70 bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">
                    {offer.customerVisibleDescription}
                  </div>
                ) : null}
              </div>
            </section>

            <Card className="border-border/70 bg-card/90 shadow-sm">
              <CardHeader>
                <CardTitle>Resumo da oferta</CardTitle>
                <CardDescription>
                  Esta página mostra o snapshot comercial emitido pela
                  CalibraFácil. Alterações cadastrais ou fiscais exigem uma nova
                  emissão.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-3">
                  {offer.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-muted/40 p-4"
                    >
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {item.label}
                        </p>
                        {item.description ? (
                          <p className="text-sm leading-6 text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Quantidade {item.quantity}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(item.totalAmount)}
                      </p>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Valor devido agora
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                      {formatCurrency(offer.totalAmount)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Valor recorrente
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                      {offer.recurringAmount
                        ? formatCurrency(offer.recurringAmount)
                        : 'Não aplicável'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/90 shadow-sm">
              <CardHeader>
                <CardTitle>Dados de referência</CardTitle>
                <CardDescription>
                  Identidade comercial do laboratório e snapshot do pagador
                  usado nesta emissão.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <IdentityCard
                  title="Laboratório"
                  lines={[
                    offer.seller.name,
                    offer.seller.cnpj ? `CNPJ ${offer.seller.cnpj}` : null,
                    formatLocation(offer.seller.city, offer.seller.state),
                    offer.seller.email,
                    formatPhone(offer.seller.phone),
                  ]}
                />
                <IdentityCard
                  title="Pagador"
                  lines={[
                    offer.payer.name,
                    offer.payer.taxId ? `CPF/CNPJ ${offer.payer.taxId}` : null,
                    offer.payer.email,
                    formatPhone(offer.payer.phone),
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="sticky top-6 border-border/70 bg-card/95 shadow-[0_18px_40px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
              <CardHeader>
                <CardTitle>{methodCopy.title}</CardTitle>
                <CardDescription>{methodCopy.body}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Status atual
                  </p>
                  <p className="mt-2 text-lg font-semibold text-foreground">
                    {STATE_LABELS[liveState]}
                  </p>
                </div>

                {startError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Não foi possível iniciar</AlertTitle>
                    <AlertDescription>{startError}</AlertDescription>
                  </Alert>
                ) : null}

                {showTerminalState ? (
                  <TerminalStateDetails
                    state={liveState}
                    paidAt={
                      statusQuery.data && statusQuery.data.state !== 'INVALID'
                        ? statusQuery.data.paidAt
                        : offer.paidAt
                    }
                  />
                ) : (
                  <>
                    <Button
                      className="h-12 w-full text-base"
                      disabled={startMutation.isPending}
                      onClick={() => startMutation.mutate()}
                    >
                      {startMutation.isPending ? (
                        <>
                          <Spinner className="mr-2" />
                          Preparando pagamento
                        </>
                      ) : (
                        methodCopy.button
                      )}
                    </Button>

                    {offer.paymentMethod === 'PIX' &&
                    livePresentation?.type === 'PIX' ? (
                      <PixInstructions
                        presentation={livePresentation}
                        copied={copiedPix}
                        onCopy={() =>
                          copyText(livePresentation.pix.payload, 'pix')
                        }
                        onVerify={() => statusQuery.refetch()}
                        isVerifying={statusQuery.isFetching}
                      />
                    ) : null}

                    {offer.paymentMethod === 'BOLETO' &&
                    livePresentation?.type === 'BOLETO' ? (
                      <BoletoInstructions
                        presentation={livePresentation}
                        copied={copiedBoleto}
                        onCopy={() =>
                          copyText(
                            livePresentation.boleto.identificationField,
                            'boleto',
                          )
                        }
                        onVerify={() => statusQuery.refetch()}
                        isVerifying={statusQuery.isFetching}
                      />
                    ) : null}

                    {offer.paymentMethod === 'CREDIT_CARD' ? (
                      <Alert>
                        <HugeiconsIcon
                          icon={CreditCardIcon}
                          className="size-4 text-foreground"
                        />
                        <AlertTitle>Finalização em ambiente seguro</AlertTitle>
                        <AlertDescription>
                          O preenchimento do cartão acontece no Asaas. Depois do
                          retorno, esta página consulta novamente o status real
                          da oferta antes de exibir qualquer confirmação.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/90 shadow-sm">
              <CardHeader>
                <CardTitle>Precisa de ajuda?</CardTitle>
                <CardDescription>
                  Use os contatos abaixo caso o link tenha expirado ou os dados
                  comerciais precisem ser reemitidos.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <SupportRow
                  label="Time responsável"
                  value={offer.seller.name}
                />
                <SupportRow label="Email" value={offer.seller.email} />
                <SupportRow
                  label="Telefone"
                  value={formatPhone(offer.seller.phone)}
                />
                <SupportRow
                  label="Observação"
                  value="Este checkout é somente leitura para preservar o snapshot emitido."
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </CheckoutFrame>
  )
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-svh overflow-hidden bg-background px-4 py-6 md:px-6 md:py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.10),transparent_32%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.09),transparent_28%),linear-gradient(180deg,rgba(2,6,23,0)_0%,rgba(15,23,42,0.03)_100%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.18),transparent_34%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.16),transparent_30%),linear-gradient(180deg,rgba(2,6,23,0.05)_0%,rgba(2,6,23,0.6)_100%)]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between rounded-full border border-border/70 bg-card/70 px-4 py-3 shadow-sm backdrop-blur">
          <Link to="/" className="inline-flex items-center">
            <BrandLockup textClassName="text-foreground" />
          </Link>
          <Badge
            variant="outline"
            className="border-border bg-background/70 text-foreground"
          >
            Checkout público
          </Badge>
        </div>
        {children}
      </div>
    </div>
  )
}

function CheckoutLoadingShell() {
  return (
    <CheckoutFrame>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-[28px]" />
          <Skeleton className="h-96 rounded-[28px]" />
          <Skeleton className="h-64 rounded-[28px]" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-[520px] rounded-[28px]" />
          <Skeleton className="h-64 rounded-[28px]" />
        </div>
      </div>
    </CheckoutFrame>
  )
}

function CenteredStateCard(props: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[70svh] items-center justify-center">
      <Card className="max-w-xl border-border/70 bg-card/95 shadow-[0_18px_40px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <CardHeader className="text-center">
          <CardDescription>{props.eyebrow}</CardDescription>
          <CardTitle className="text-3xl tracking-tight">
            {props.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm leading-7 text-muted-foreground">
          {props.description}
        </CardContent>
      </Card>
    </div>
  )
}

function OutcomeHint({ outcome }: { outcome: ProviderOutcome }) {
  const content =
    outcome === 'success'
      ? {
          title: 'Retorno recebido do provedor',
          body: 'Estamos confirmando o status final do pagamento diretamente com a CalibraFácil.',
        }
      : outcome === 'cancel'
        ? {
            title: 'Pagamento não concluído',
            body: 'Você pode revisar a oferta e iniciar novamente quando quiser.',
          }
        : {
            title: 'Sessão expirada',
            body: 'Se a oferta ainda estiver válida, você pode iniciar uma nova tentativa de pagamento.',
          }

  return (
    <Alert>
      <HugeiconsIcon icon={HelpCircleIcon} className="size-4 text-foreground" />
      <AlertTitle>{content.title}</AlertTitle>
      <AlertDescription>{content.body}</AlertDescription>
    </Alert>
  )
}

function StatusBadge({ state }: { state: CheckoutState }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border px-3 py-1 text-sm font-medium',
        STATE_BADGE_CLASS[state],
      )}
    >
      {STATE_LABELS[state]}
    </Badge>
  )
}

function InfoPill(props: {
  icon: typeof CreditCardIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <HugeiconsIcon icon={props.icon} className="size-4" />
        <span className="text-xs uppercase tracking-[0.18em]">
          {props.label}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">
        {props.value}
      </p>
    </div>
  )
}

function IdentityCard(props: { title: string; lines: Array<string | null> }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {props.title}
      </p>
      <div className="mt-3 space-y-2 text-sm leading-6 text-foreground/85">
        {props.lines.filter(Boolean).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}

function PixInstructions(props: {
  presentation: Extract<PublicCheckoutPresentation, { type: 'PIX' }>
  copied: boolean
  onCopy: () => void
  onVerify: () => void
  isVerifying: boolean
}) {
  return (
    <div className="space-y-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          Pix pronto para pagamento
        </p>
        <p className="text-sm leading-6 text-emerald-700/80 dark:text-emerald-200/80">
          Escaneie o QR Code ou copie o código abaixo. O status é atualizado
          automaticamente.
        </p>
      </div>

      <div className="flex justify-center rounded-2xl bg-background/90 p-4 shadow-sm">
        {props.presentation.pix.qrCodeImage ? (
          <img
            src={props.presentation.pix.qrCodeImage}
            alt="QR Code Pix"
            className="size-52 rounded-xl"
          />
        ) : (
          <div className="flex size-52 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            QR indisponível
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-background/90 p-4 shadow-sm">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Código Pix copia e cola
        </p>
        <p className="mt-3 break-all font-mono text-xs leading-6 text-foreground/85">
          {props.presentation.pix.payload ?? 'Aguardando payload do provedor'}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button variant="outline" onClick={props.onCopy} className="w-full">
          <HugeiconsIcon
            icon={props.copied ? Tick02Icon : Copy01Icon}
            className="mr-2 size-4"
          />
          {props.copied ? 'Código copiado' : 'Copiar código Pix'}
        </Button>
        <Button variant="ghost" onClick={props.onVerify} className="w-full">
          {props.isVerifying ? (
            <>
              <Spinner className="mr-2" />
              Verificando
            </>
          ) : (
            'Já paguei / verificar status'
          )}
        </Button>
      </div>

      <p className="text-xs text-emerald-700/80 dark:text-emerald-200/80">
        Expiração: {formatDateTime(props.presentation.pix.expirationDate)}
      </p>
    </div>
  )
}

function BoletoInstructions(props: {
  presentation: Extract<PublicCheckoutPresentation, { type: 'BOLETO' }>
  copied: boolean
  onCopy: () => void
  onVerify: () => void
  isVerifying: boolean
}) {
  return (
    <div className="space-y-4 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          Boleto emitido
        </p>
        <p className="text-sm leading-6 text-amber-700/80 dark:text-amber-200/80">
          Use a linha digitável no seu banco ou abra o boleto em PDF no
          provedor.
        </p>
      </div>

      <div className="rounded-2xl bg-background/90 p-4 shadow-sm">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Linha digitável
        </p>
        <p className="mt-3 break-all font-mono text-xs leading-6 text-foreground/85">
          {props.presentation.boleto.identificationField ??
            'Linha não disponível'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="outline" onClick={props.onCopy}>
          <HugeiconsIcon
            icon={props.copied ? Tick02Icon : Copy01Icon}
            className="mr-2 size-4"
          />
          {props.copied ? 'Linha copiada' : 'Copiar linha'}
        </Button>
        <Button
          onClick={() => {
            if (props.presentation.boleto.bankSlipUrl) {
              window.open(
                props.presentation.boleto.bankSlipUrl,
                '_blank',
                'noopener,noreferrer',
              )
            }
          }}
          disabled={!props.presentation.boleto.bankSlipUrl}
        >
          Abrir boleto
        </Button>
      </div>

      <Button variant="ghost" onClick={props.onVerify} className="w-full">
        {props.isVerifying ? (
          <>
            <Spinner className="mr-2" />
            Verificando
          </>
        ) : (
          'Verificar status'
        )}
      </Button>

      <p className="text-xs text-amber-700/80 dark:text-amber-200/80">
        Vencimento: {formatDate(props.presentation.boleto.dueDate)}
      </p>
    </div>
  )
}

function TerminalStateDetails(props: {
  state: Exclude<
    CheckoutState,
    'INVALID' | 'AWAITING_PAYMENT' | 'PIX_READY' | 'BOLETO_READY'
  >
  paidAt?: string | null
}) {
  const content =
    props.state === 'PAID'
      ? {
          title: 'Pagamento confirmado',
          body: props.paidAt
            ? `Recebimento confirmado em ${formatDateTime(props.paidAt)}.`
            : 'Recebimento confirmado e oferta processada.',
        }
      : props.state === 'EXPIRED'
        ? {
            title: 'Link expirado',
            body: 'Peça uma nova emissão ao time comercial para continuar.',
          }
        : props.state === 'REVOKED'
          ? {
              title: 'Oferta substituída',
              body: 'Este link foi revogado e não aceita novas tentativas.',
            }
          : props.state === 'OVERDUE'
            ? {
                title: 'Pagamento em atraso',
                body: 'O vencimento foi ultrapassado. Solicite uma reemissão antes de tentar pagar.',
              }
            : props.state === 'REFUNDED'
              ? {
                  title: 'Pagamento devolvido',
                  body: 'O pagamento foi estornado ou devolvido. Confirme os próximos passos com o laboratório.',
                }
              : {
                  title: 'Oferta cancelada',
                  body: 'Esta oferta foi cancelada e o link não está mais disponível para pagamento.',
                }

  return (
    <Alert>
      <HugeiconsIcon icon={Tick02Icon} className="size-4 text-foreground" />
      <AlertTitle>{content.title}</AlertTitle>
      <AlertDescription>{content.body}</AlertDescription>
    </Alert>
  )
}

function SupportRow(props: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/35 p-3">
      <HugeiconsIcon
        icon={CustomerSupportIcon}
        className="mt-0.5 size-4 text-muted-foreground"
      />
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {props.label}
        </p>
        <p className="mt-1 text-sm text-foreground/85">
          {props.value || 'Não informado'}
        </p>
      </div>
    </div>
  )
}

function paymentMethodIcon(method: 'PIX' | 'BOLETO' | 'CREDIT_CARD') {
  if (method === 'PIX') return QrCodeIcon
  if (method === 'BOLETO') return Invoice01Icon
  return CreditCardIcon
}

function paymentMethodLabel(method: 'PIX' | 'BOLETO' | 'CREDIT_CARD') {
  if (method === 'PIX') return 'Pix'
  if (method === 'BOLETO') return 'Boleto'
  return 'Cartão de crédito'
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value / 100)
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Não informado'

  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Não informado'

  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLocation(city: string | null, state: string | null) {
  if (!city && !state) return null
  return [city, state].filter(Boolean).join(' - ')
}
