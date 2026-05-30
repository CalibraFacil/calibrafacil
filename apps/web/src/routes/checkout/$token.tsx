import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  Calendar03Icon,
  CheckmarkBadge04Icon,
  Copy01Icon,
  CreditCardIcon,
  Download04Icon,
  HelpCircleIcon,
  Invoice01Icon,
  QrCodeIcon,
  RefreshIcon,
  SentIcon,
  SquareLock02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { BrandLockup } from '@/components/brand'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { StaggerGroup, StaggerItem } from '@/components/instrument-panel'
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
      <StaggerGroup className="space-y-4">
        <StaggerItem>
          <div className="relative overflow-hidden rounded-[28px] bg-card p-6 shadow-[0_24px_60px_-24px_rgba(2,6,23,0.30)] ring-1 ring-black/[0.06] dark:ring-white/[0.08] sm:p-7">
            <div
              aria-hidden
              className="absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-teal-500/55 to-transparent"
            />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Proposta de {offer.seller.name}
                </p>
                <h1 className="text-pretty text-xl font-semibold leading-snug tracking-tight">
                  {offer.items[0]?.label ?? 'Proposta comercial'}
                </h1>
              </div>
              <StatusBadge state={liveState} />
            </div>

            <div className="mt-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Total a pagar
              </p>
              <p className="mt-1.5 text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums">
                {formatCurrency(offer.totalAmount)}
              </p>
              {offer.recurringAmount != null &&
              offer.recurringAmount !== offer.totalAmount ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Depois,{' '}
                  <span className="tabular-nums">
                    {formatCurrency(offer.recurringAmount)}
                  </span>{' '}
                  por período.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <HugeiconsIcon icon={Calendar03Icon} className="size-3.5" />
                  vence {formatDate(offer.dueDate)}
                </span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <HugeiconsIcon
                    icon={paymentMethodIcon(offer.paymentMethod)}
                    className="size-3.5"
                  />
                  {paymentMethodLabel(offer.paymentMethod)}
                </span>
                {offer.offerExpiresAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>válido até {formatDate(offer.offerExpiresAt)}</span>
                  </>
                ) : null}
              </div>
            </div>

            {providerOutcome ? (
              <div className="mt-5">
                <OutcomeHint outcome={providerOutcome} />
              </div>
            ) : null}

            {startError ? (
              <div className="mt-5">
                <Alert variant="destructive">
                  <AlertTitle>Não foi possível iniciar</AlertTitle>
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              </div>
            ) : null}

            <div className="mt-6">
              {showTerminalState ? (
                <TerminalStateDetails
                  state={liveState}
                  paidAt={
                    statusQuery.data && statusQuery.data.state !== 'INVALID'
                      ? statusQuery.data.paidAt
                      : offer.paidAt
                  }
                />
              ) : livePresentation?.type === 'PIX' ? (
                <PixInstructions
                  presentation={livePresentation}
                  copied={copiedPix}
                  onCopy={() => copyText(livePresentation.pix.payload, 'pix')}
                  onVerify={() => statusQuery.refetch()}
                  isVerifying={statusQuery.isFetching}
                />
              ) : livePresentation?.type === 'BOLETO' ? (
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
              ) : (
                <div className="space-y-2.5">
                  <Button
                    className="h-12 w-full text-base transition-transform active:scale-[0.97]"
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
                  <p className="text-center text-xs leading-5 text-muted-foreground">
                    {methodCopy.body}
                  </p>
                </div>
              )}
            </div>

            {!showTerminalState ? (
              <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <HugeiconsIcon
                  icon={CheckmarkBadge04Icon}
                  className="mt-0.5 size-3.5 shrink-0 text-emerald-500"
                />
                <span>
                  Assim que confirmarmos o pagamento, liberamos o acesso
                  {offer.payer.email
                    ? ` e enviamos o comprovante para ${offer.payer.email}`
                    : ''}
                  . Confirmação automática — você não precisa avisar.
                </span>
              </p>
            ) : null}
          </div>
        </StaggerItem>

        <StaggerItem>
          <p className="flex items-center justify-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} className="size-3.5" />
            Pagamento processado com segurança pela Asaas
          </p>
        </StaggerItem>

        <StaggerItem>
          <div className="space-y-3 rounded-2xl bg-card/60 p-5 ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Resumo da proposta
            </p>
            <div className="space-y-2">
              {offer.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.quantity > 1 ? (
                      <span className="text-xs text-muted-foreground">
                        Qtd {item.quantity}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatCurrency(item.totalAmount)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-black/[0.06] pt-3 text-sm dark:border-white/[0.08]">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold tabular-nums">
                {formatCurrency(offer.totalAmount)}
              </span>
            </div>
            {offer.recurringAmount != null &&
            offer.recurringAmount !== offer.totalAmount ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Recorrente</span>
                <span className="tabular-nums">
                  {formatCurrency(offer.recurringAmount)}
                </span>
              </div>
            ) : null}
            {offer.customerVisibleDescription ? (
              <p className="rounded-xl bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                {offer.customerVisibleDescription}
              </p>
            ) : null}
          </div>
        </StaggerItem>

        <StaggerItem>
          <ForwardToFinance />
        </StaggerItem>

        <StaggerItem>
          <details className="group rounded-2xl bg-card/60 p-5 ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
              Identidade fiscal e ajuda
              <HugeiconsIcon
                icon={ArrowRight02Icon}
                className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
              />
            </summary>
            <div className="mt-4 space-y-4">
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
              <p className="text-xs leading-5 text-muted-foreground">
                Link expirado ou dados incorretos? Fale com {offer.seller.name}
                {offer.seller.email ? ` (${offer.seller.email})` : ''} para uma
                nova emissão. Este checkout é somente leitura para preservar o
                snapshot emitido.
              </p>
            </div>
          </details>
        </StaggerItem>
      </StaggerGroup>
    </CheckoutFrame>
  )
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-svh bg-background antialiased">
      {/* Faint precision dot-grid — a metrology signature, not a gradient blob. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(125,128,145,0.13) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(120% 55% at 50% 0%, black, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(120% 55% at 50% 0%, black, transparent 78%)',
        }}
      />
      <div className="relative mx-auto flex w-full max-w-lg flex-col px-4 pb-12 pt-7 sm:pt-10">
        <header className="mb-7 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center transition-opacity hover:opacity-80"
          >
            <BrandLockup
              markClassName="size-6"
              textClassName="text-base text-foreground"
            />
          </Link>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} className="size-3.5" />
            Seguro
          </span>
        </header>
        {children}
      </div>
    </div>
  )
}

function CheckoutLoadingShell() {
  return (
    <CheckoutFrame>
      <div className="space-y-4">
        <Skeleton className="h-[22rem] rounded-[28px]" />
        <Skeleton className="mx-auto h-4 w-64 rounded-full" />
        <Skeleton className="h-32 rounded-2xl" />
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
    <div className="rounded-[28px] bg-card p-8 text-center shadow-[0_24px_60px_-24px_rgba(2,6,23,0.30)] ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {props.eyebrow}
      </p>
      <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight">
        {props.title}
      </h1>
      <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">
        {props.description}
      </p>
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
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em]',
        STATE_BADGE_CLASS[state],
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {STATE_LABELS[state]}
    </span>
  )
}

function IdentityCard(props: { title: string; lines: Array<string | null> }) {
  return (
    <div className="rounded-xl bg-muted/40 p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.07]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
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

/** B2B affordance: the opener is rarely the payer — copy the link to forward. */
function ForwardToFinance() {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      className="w-full transition-transform active:scale-[0.98]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
          toast.success('Link copiado para encaminhar')
        } catch {
          toast.error('Não foi possível copiar o link')
        }
      }}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : SentIcon}
        className="mr-2 size-4"
      />
      {copied ? 'Link copiado' : 'Encaminhar para o financeiro'}
    </Button>
  )
}

function AutoConfirmRow({
  onVerify,
  isVerifying,
  note,
}: {
  onVerify: () => void
  isVerifying: boolean
  note?: string | null
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          Confirmamos automaticamente assim que o pagamento cair.
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onVerify}
          className="h-7 px-2"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            className={cn('mr-1 size-3.5', isVerifying && 'animate-spin')}
          />
          Atualizar
        </Button>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
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
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/30 p-5 ring-1 ring-black/[0.05] dark:ring-white/[0.07]">
        {props.presentation.pix.qrCodeImage ? (
          <img
            src={props.presentation.pix.qrCodeImage}
            alt="QR Code Pix"
            className="size-56 rounded-xl bg-white p-2.5 outline outline-1 -outline-offset-1 outline-black/10"
          />
        ) : (
          <div className="flex size-56 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
            QR indisponível
          </div>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Abra o app do seu banco e escaneie o QR Code para pagar.
        </p>
      </div>

      <div className="rounded-2xl bg-muted/40 p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.07]">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Pix copia e cola
        </p>
        <p className="mt-2 break-all font-mono text-xs leading-5 text-foreground/80">
          {props.presentation.pix.payload ?? 'Aguardando código…'}
        </p>
        <Button
          variant="outline"
          onClick={props.onCopy}
          className="mt-3 w-full transition-transform active:scale-[0.98]"
        >
          <HugeiconsIcon
            icon={props.copied ? Tick02Icon : Copy01Icon}
            className="mr-2 size-4"
          />
          {props.copied ? 'Código copiado' : 'Copiar código Pix'}
        </Button>
      </div>

      <AutoConfirmRow
        onVerify={props.onVerify}
        isVerifying={props.isVerifying}
        note={`Expira em ${formatDateTime(props.presentation.pix.expirationDate)}`}
      />
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
    <div className="space-y-4">
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
        className="h-12 w-full text-base transition-transform active:scale-[0.99]"
      >
        <HugeiconsIcon icon={Download04Icon} className="mr-2 size-4" />
        Baixar boleto (PDF)
      </Button>

      <div className="rounded-2xl bg-muted/40 p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.07]">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Linha digitável
        </p>
        <p className="mt-2 break-all font-mono text-xs leading-5 text-foreground/80">
          {props.presentation.boleto.identificationField ??
            'Linha não disponível'}
        </p>
        <Button
          variant="outline"
          onClick={props.onCopy}
          className="mt-3 w-full transition-transform active:scale-[0.98]"
        >
          <HugeiconsIcon
            icon={props.copied ? Tick02Icon : Copy01Icon}
            className="mr-2 size-4"
          />
          {props.copied ? 'Linha copiada' : 'Copiar linha digitável'}
        </Button>
      </div>

      <AutoConfirmRow
        onVerify={props.onVerify}
        isVerifying={props.isVerifying}
        note={`Vence ${formatDate(props.presentation.boleto.dueDate)}`}
      />
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
  if (props.state === 'PAID') {
    return (
      <div className="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/15">
          <HugeiconsIcon
            icon={CheckmarkBadge04Icon}
            className="size-7 text-emerald-600 dark:text-emerald-400"
          />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold">Pagamento confirmado</p>
          <p className="text-sm leading-6 text-muted-foreground">
            {props.paidAt ? `Recebido em ${formatDateTime(props.paidAt)}. ` : ''}
            Seu acesso foi liberado.
          </p>
        </div>
        <Button
          className="w-full transition-transform active:scale-[0.98]"
          render={<Link to="/" />}
        >
          Acessar a CalibraFácil
          <HugeiconsIcon icon={ArrowRight02Icon} className="ml-1 size-4" />
        </Button>
      </div>
    )
  }

  const content =
    props.state === 'EXPIRED'
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
