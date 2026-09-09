import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  AlertCircleIcon,
  ArrowRight02Icon,
  ArrowTurnBackwardIcon,
  Cancel01Icon,
  CheckmarkBadge04Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Copy01Icon,
  CreditCardIcon,
  Download04Icon,
  Invoice01Icon,
  RefreshIcon,
  SentIcon,
  SquareLock02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { BrandLockup } from '@/components/brand'
import { PixIcon } from '@/components/payment-brand-icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { StaggerGroup, StaggerItem } from '@/components/instrument-panel'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { LEGAL_ENTITY } from '@/lib/legal'
import { cn } from '@/lib/utils'
import { calibraApi } from '@/utils/api'

import {
  amountCadence,
  describeDeadline,
  describeOfferKind,
  describeRenewal,
  describePixValidity,
  describeSubject,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  isTerminalState,
  paymentMethodLabel,
  planHighlights,
  STATE_LABELS,
  TERMINAL_COPY,
  type CheckoutOffer,
  type PaymentMethod,
  type TerminalState,
} from './checkout-model'
import {
  usePublicCheckoutSnapshotData,
  usePublicCheckoutStatusData,
} from './queries'
import type {
  CheckoutState,
  PublicCheckoutPresentation,
  PublicCheckoutStartResponse,
} from './types'

export type ProviderOutcome = 'success' | 'cancel' | 'expired'

type PublicCheckoutPageProps = {
  token: string
  providerOutcome?: ProviderOutcome
}

/**
 * The public payment page for a commercial offer — the last screen before a
 * laboratory becomes a paying customer.
 *
 * It is written from the buyer's side of the table: CalibraFácil is the
 * vendor, the laboratory is the contracting party, and the three questions a
 * buyer asks before paying are answered in order and above the fold — what
 * am I buying, how much and when again, and who am I paying.
 */
export function PublicCheckoutPage({
  token,
  providerOutcome,
}: PublicCheckoutPageProps) {
  const queryClient = useQueryClient()
  const [startError, setStartError] = useState<string | null>(null)

  const snapshotQuery = usePublicCheckoutSnapshotData(token)
  const snapshot = snapshotQuery.data

  const shouldPoll =
    snapshot?.state === 'PIX_READY' ||
    snapshot?.state === 'BOLETO_READY' ||
    snapshot?.state === 'AWAITING_PAYMENT' ||
    Boolean(providerOutcome)

  const statusQuery = usePublicCheckoutStatusData({
    token,
    enabled: shouldPoll,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.state === 'INVALID') return false
      if (isTerminalState(data.state)) return false
      return snapshot?.offer?.paymentMethod === 'BOLETO' ? 30000 : 5000
    },
  })

  const startMutation = useMutation({
    mutationFn: () =>
      calibraApi.publicCheckout.start<PublicCheckoutStartResponse>(token),
    onMutate: () => setStartError(null),
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

  const liveStatus =
    statusQuery.data && statusQuery.data.state !== 'INVALID'
      ? statusQuery.data
      : null
  const liveState: CheckoutState =
    liveStatus?.state ?? snapshot?.state ?? 'AWAITING_PAYMENT'
  const livePresentation: PublicCheckoutPresentation | null =
    liveStatus?.presentation ?? snapshot?.presentation ?? null

  if (snapshotQuery.isLoading) {
    return <LoadingShell />
  }

  if (snapshotQuery.isError || !snapshot) {
    return (
      <Frame>
        <StateCard
          icon={AlertCircleIcon}
          title="Não foi possível carregar a proposta"
          description="Tente abrir o link de novo em alguns instantes. Se continuar, fale com a equipe e peça um novo link."
        />
      </Frame>
    )
  }

  if (snapshot.state === 'INVALID' || !snapshot.offer) {
    return (
      <Frame>
        <StateCard
          icon={Cancel01Icon}
          title="Este link não está disponível"
          description="O endereço pode estar incompleto, ter expirado ou ter sido substituído por um envio mais recente."
        />
      </Frame>
    )
  }

  const offer = snapshot.offer
  const subject = describeSubject(offer)
  const cadence = amountCadence(offer)
  const renewal = describeRenewal(offer)
  const deadline = describeDeadline(offer)
  const terminal = isTerminalState(liveState) ? liveState : null
  const awaitingProvider = providerOutcome === 'success' && !terminal

  return (
    <Frame wide>
      {/* Two columns on desktop so price, contents, parties and the button
          share one viewport: a pay page with one decision should not need a
          scroll to see what the decision is. Mobile stacks, summary first. */}
      <StaggerGroup className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:gap-5">
        <StaggerItem>
          <section className="relative overflow-hidden rounded-[28px] bg-card p-5 shadow-[0_1px_2px_rgba(2,6,23,0.04),0_24px_60px_-28px_rgba(2,6,23,0.35)] ring-1 ring-black/[0.06] dark:ring-white/[0.08] sm:p-6">
            <div
              aria-hidden
              className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent"
            />

            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {describeOfferKind(offer)}
            </p>
            <h1 className="mt-2 text-balance text-2xl font-semibold leading-tight tracking-tight">
              {subject.title}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              para <span className="text-foreground">{offer.seller.name}</span>
            </p>

            <div className="mt-5 flex items-baseline gap-2">
              <p className="text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                {formatCurrency(offer.totalAmount)}
              </p>
              {cadence ? (
                <p className="text-base text-muted-foreground">{cadence}</p>
              ) : null}
            </div>
            {renewal ? (
              <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
                {renewal}
              </p>
            ) : null}

            <div className="mt-5 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
              {subject.planId ? (
                <>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Incluído
                  </p>
                  <ul className="mt-2.5 space-y-1.5">
                    {planHighlights(subject.planId).map((line) => (
                      <li
                        key={line}
                        className="flex items-start gap-2 text-sm leading-6"
                      >
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="mt-1 size-4 shrink-0 text-indigo-600 dark:text-indigo-400"
                          strokeWidth={2.25}
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ItemBreakdown offer={offer} />
              )}
            </div>

            <div className="mt-5 grid gap-3 border-t border-black/[0.06] pt-4 sm:grid-cols-2 dark:border-white/[0.08]">
              <Party
                title="Fornecedor"
                lines={[
                  'CalibraFácil',
                  `CNPJ ${LEGAL_ENTITY.cnpj}`,
                  LEGAL_ENTITY.email,
                ]}
              />
              <Party
                title="Contratante"
                lines={[
                  offer.seller.name,
                  offer.seller.cnpj
                    ? `CNPJ ${offer.seller.cnpj}`
                    : offer.payer.taxId
                      ? `CPF/CNPJ ${offer.payer.taxId}`
                      : null,
                  offer.payer.email ?? offer.seller.email,
                  formatPhone(offer.payer.phone ?? offer.seller.phone),
                ]}
              />
            </div>
          </section>
        </StaggerItem>

        <StaggerItem>
          <section className="rounded-[28px] bg-card p-5 shadow-[0_1px_2px_rgba(2,6,23,0.04),0_24px_60px_-28px_rgba(2,6,23,0.35)] ring-1 ring-black/[0.06] dark:ring-white/[0.08] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge state={liveState} />
              <div className="flex flex-wrap gap-1.5">
                <MetaChip
                  icon={<PaymentMethodIcon method={offer.paymentMethod} />}
                >
                  {paymentMethodLabel(offer.paymentMethod)}
                </MetaChip>
                {deadline ? (
                  <MetaChip
                    icon={
                      <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
                    }
                  >
                    {deadline}
                  </MetaChip>
                ) : null}
              </div>
            </div>

            {providerOutcome && !terminal ? (
              <div className="mt-4">
                <OutcomeHint
                  outcome={providerOutcome}
                  polling={statusQuery.isFetching}
                />
              </div>
            ) : null}

            {startError ? (
              <div className="mt-4">
                <Alert variant="destructive">
                  <HugeiconsIcon icon={AlertCircleIcon} className="size-4" />
                  <AlertTitle>Não foi possível iniciar o pagamento</AlertTitle>
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              </div>
            ) : null}

            <div className="mt-5">
              {terminal ? (
                <TerminalPanel
                  state={terminal}
                  paidAt={liveStatus?.paidAt ?? offer.paidAt}
                />
              ) : livePresentation?.type === 'PIX' ? (
                <PixPanel
                  key={livePresentation.pix.expirationDate ?? 'pix'}
                  presentation={livePresentation}
                  onVerify={() => statusQuery.refetch()}
                  isVerifying={statusQuery.isFetching}
                  onRegenerate={() => startMutation.mutate()}
                  isRegenerating={startMutation.isPending}
                />
              ) : livePresentation?.type === 'BOLETO' ? (
                <BoletoPanel
                  presentation={livePresentation}
                  onVerify={() => statusQuery.refetch()}
                  isVerifying={statusQuery.isFetching}
                />
              ) : awaitingProvider ? (
                <ConfirmingRow
                  onVerify={() => statusQuery.refetch()}
                  isVerifying={statusQuery.isFetching}
                />
              ) : (
                <StartAction
                  method={offer.paymentMethod}
                  amount={offer.totalAmount}
                  pending={startMutation.isPending}
                  onStart={() => startMutation.mutate()}
                />
              )}
            </div>

            {!terminal ? (
              <p className="mt-4 flex items-start gap-2 text-pretty text-xs leading-5 text-muted-foreground">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="mt-0.5 size-3.5 shrink-0 text-emerald-500"
                />
                <span>
                  O acesso é liberado assim que o pagamento é confirmado
                  {offer.payer.email ? (
                    <>
                      ; o comprovante vai para{' '}
                      <span className="text-foreground">
                        {offer.payer.email}
                      </span>
                    </>
                  ) : null}
                  . Confirmação automática.
                </span>
              </p>
            ) : null}

            <div className="mt-5 flex flex-col items-center gap-2 border-t border-black/[0.06] pt-4 text-center dark:border-white/[0.08]">
              <p className="inline-flex items-center gap-1.5 text-pretty font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <HugeiconsIcon
                  icon={SquareLock02Icon}
                  className="size-3.5 shrink-0"
                />
                Pagamento processado pela Asaas
              </p>
              <ForwardLink />
              <p className="text-pretty text-xs leading-5 text-muted-foreground">
                Dúvidas?{' '}
                <a
                  href={`mailto:${LEGAL_ENTITY.email}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {LEGAL_ENTITY.email}
                </a>
              </p>
            </div>
          </section>
        </StaggerItem>
      </StaggerGroup>
    </Frame>
  )
}

/* -------------------------------------------------------------------------- */
/* Frame + shells                                                             */
/* -------------------------------------------------------------------------- */

function Frame({
  children,
  wide = false,
}: {
  children: ReactNode
  wide?: boolean
}) {
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
          maskImage:
            'radial-gradient(120% 55% at 50% 0%, black, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(120% 55% at 50% 0%, black, transparent 78%)',
        }}
      />
      <div
        className={cn(
          'relative mx-auto flex w-full flex-col px-4 pb-14 pt-6 sm:pt-8',
          wide ? 'max-w-lg lg:max-w-5xl' : 'max-w-lg',
        )}
      >
        <header className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex min-h-10 items-center transition-opacity hover:opacity-80"
          >
            <BrandLockup
              markClassName="size-6"
              textClassName="text-base text-foreground"
            />
          </Link>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} className="size-3.5" />
            Pagamento seguro
          </span>
        </header>
        {children}
      </div>
    </div>
  )
}

function LoadingShell() {
  return (
    <Frame wide>
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr] lg:gap-5">
        <Skeleton className="h-[26rem] rounded-[28px]" />
        <Skeleton className="h-[18rem] rounded-[28px]" />
      </div>
    </Frame>
  )
}

function StateCard(props: {
  icon: IconSvgElement
  title: string
  description: string
}) {
  return (
    <div className="rounded-[28px] bg-card p-8 text-center shadow-[0_24px_60px_-28px_rgba(2,6,23,0.35)] ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <HugeiconsIcon icon={props.icon} className="size-6" />
      </span>
      <h1 className="mt-4 text-balance text-2xl font-semibold tracking-tight">
        {props.title}
      </h1>
      <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">
        {props.description}
      </p>
      <Button
        variant="outline"
        className="mt-6 transition-transform active:scale-[0.96]"
        render={<a href={`mailto:${LEGAL_ENTITY.email}`} />}
      >
        Falar com a equipe
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Small parts                                                                */
/* -------------------------------------------------------------------------- */

function MetaChip({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
      {icon}
      {children}
    </span>
  )
}

/**
 * Pix is a brand mark and keeps its own colour; boleto and card are product
 * line icons and follow the text. The chip is the one place the mark drops
 * under the manual's 24 px minimum (20 px) — the panel and the button above
 * it carry the full-size mark.
 */
function PaymentMethodIcon({
  method,
  className,
}: {
  method: PaymentMethod
  className?: string
}) {
  if (method === 'PIX') {
    return <PixIcon className={cn('size-5', className)} />
  }
  return (
    <HugeiconsIcon
      icon={method === 'BOLETO' ? Invoice01Icon : CreditCardIcon}
      className={cn('size-3.5', className)}
    />
  )
}

const STATE_BADGE_CLASS: Record<CheckoutState, string> = {
  INVALID: 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300',
  EXPIRED:
    'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
  REVOKED: 'bg-zinc-500/10 text-zinc-700 ring-zinc-500/20 dark:text-zinc-300',
  AWAITING_PAYMENT:
    'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
  PIX_READY:
    'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  BOLETO_READY:
    'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
  PAID: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  OVERDUE:
    'bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300',
  REFUNDED: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300',
  CANCELED: 'bg-zinc-500/10 text-zinc-700 ring-zinc-500/20 dark:text-zinc-300',
}

function StatusBadge({ state }: { state: CheckoutState }) {
  const live = state === 'AWAITING_PAYMENT' || state === 'PIX_READY'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ring-1 ring-inset',
        STATE_BADGE_CLASS[state],
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-current opacity-70',
          live && 'animate-pulse',
        )}
      />
      {STATE_LABELS[state]}
    </span>
  )
}

function Party(props: { title: string; lines: Array<string | null> }) {
  const lines = props.lines.filter(
    (line): line is string => typeof line === 'string' && line.length > 0,
  )
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {props.title}
      </p>
      <div className="mt-1.5 space-y-0.5 text-sm leading-6">
        {lines.map((line, index) => (
          <p
            key={line}
            className={cn(
              index === 0 ? 'font-medium' : 'text-muted-foreground',
              index > 0 && /\d/.test(line) && 'tabular-nums',
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

function ItemBreakdown({ offer }: { offer: CheckoutOffer }) {
  return (
    <>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Resumo
      </p>
      <div className="mt-3 space-y-2">
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
      <div className="mt-3 flex items-center justify-between border-t border-black/[0.06] pt-3 text-sm dark:border-white/[0.08]">
        <span className="text-muted-foreground">Total</span>
        <span className="font-semibold tabular-nums">
          {formatCurrency(offer.totalAmount)}
        </span>
      </div>
      {offer.customerVisibleDescription ? (
        <p className="mt-3 text-pretty text-xs leading-5 text-muted-foreground">
          {offer.customerVisibleDescription}
        </p>
      ) : null}
    </>
  )
}

/** Cross-fades between two icons the way the design-details guide prescribes. */
function SwapIcon({
  icon,
  swapped,
  swappedIcon,
  className,
}: {
  icon: IconSvgElement
  swapped: boolean
  swappedIcon: IconSvgElement
  className?: string
}) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0', className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={swapped ? 'swapped' : 'base'}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        >
          <HugeiconsIcon
            icon={swapped ? swappedIcon : icon}
            className="size-4"
          />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function useCopied() {
  const [copied, setCopied] = useState(false)

  async function copy(value: string | null | undefined, success: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(success)
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  return { copied, copy }
}

/* -------------------------------------------------------------------------- */
/* Action states                                                              */
/* -------------------------------------------------------------------------- */

const START_COPY: Record<PaymentMethod, { verb: string; body: string }> = {
  PIX: {
    verb: 'Gerar Pix de',
    body: 'O QR Code aparece nesta página.',
  },
  BOLETO: {
    verb: 'Gerar boleto de',
    body: 'O boleto abre em outra aba.',
  },
  CREDIT_CARD: {
    verb: 'Pagar',
    body: 'Você será levado à página segura da Asaas.',
  },
}

function StartAction({
  method,
  amount,
  pending,
  onStart,
}: {
  method: PaymentMethod
  amount: number
  pending: boolean
  onStart: () => void
}) {
  const copy = START_COPY[method]
  return (
    <div className="space-y-2.5">
      <Button
        className="h-12 w-full text-base transition-transform active:scale-[0.96]"
        disabled={pending}
        onClick={onStart}
      >
        {pending ? (
          <>
            <Spinner className="mr-2" />
            Preparando pagamento
          </>
        ) : (
          <>
            {method === 'PIX' ? (
              // White is one of the three colours the manual allows, and the
              // only one that reads on the primary button.
              <PixIcon tone="mono" className="mr-2 size-6 text-white" />
            ) : null}
            {copy.verb}{' '}
            <span className="tabular-nums">{formatCurrency(amount)}</span>
            {method !== 'PIX' ? (
              <HugeiconsIcon icon={ArrowRight02Icon} className="ml-1 size-4" />
            ) : null}
          </>
        )}
      </Button>
      <p className="text-center text-pretty text-xs leading-5 text-muted-foreground">
        {copy.body}
      </p>
    </div>
  )
}

function OutcomeHint({
  outcome,
  polling,
}: {
  outcome: ProviderOutcome
  polling: boolean
}) {
  if (outcome === 'success') {
    return (
      <Alert>
        {polling ? (
          <Spinner className="size-4" />
        ) : (
          <HugeiconsIcon icon={Clock01Icon} className="size-4" />
        )}
        <AlertTitle>Pagamento enviado</AlertTitle>
        <AlertDescription>
          Confirmando com a operadora. A página atualiza sozinha.
        </AlertDescription>
      </Alert>
    )
  }

  const content =
    outcome === 'cancel'
      ? {
          title: 'Pagamento não concluído',
          body: 'Nada foi cobrado. Tente novamente quando quiser.',
        }
      : {
          title: 'A sessão de pagamento expirou',
          body: 'Nada foi cobrado. Tente novamente abaixo.',
        }

  return (
    <Alert>
      <HugeiconsIcon icon={AlertCircleIcon} className="size-4" />
      <AlertTitle>{content.title}</AlertTitle>
      <AlertDescription>{content.body}</AlertDescription>
    </Alert>
  )
}

function ConfirmingRow({
  onVerify,
  isVerifying,
}: {
  onVerify: () => void
  isVerifying: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        Aguardando confirmação da operadora
      </span>
      <VerifyButton onVerify={onVerify} isVerifying={isVerifying} />
    </div>
  )
}

function VerifyButton({
  onVerify,
  isVerifying,
}: {
  onVerify: () => void
  isVerifying: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onVerify}
      // 40px hit target even though it reads as a small text button.
      className="h-10 px-3 transition-transform active:scale-[0.96]"
    >
      <HugeiconsIcon
        icon={RefreshIcon}
        className={cn('mr-1 size-3.5', isVerifying && 'animate-spin')}
      />
      Atualizar
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
  note?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        <span>
          Confirmação automática
          {note ? <> · {note}</> : null}
        </span>
      </span>
      <VerifyButton onVerify={onVerify} isVerifying={isVerifying} />
    </div>
  )
}

/** Re-renders the validity label each second so the final hour actually counts. */
function usePixValidity(expirationDate: string | null) {
  const [now, setNow] = useState(() => new Date())

  useMountEffect(() => {
    if (!expirationDate) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  })

  return describePixValidity(expirationDate, now)
}

function PixPanel(props: {
  presentation: Extract<PublicCheckoutPresentation, { type: 'PIX' }>
  onVerify: () => void
  isVerifying: boolean
  onRegenerate: () => void
  isRegenerating: boolean
}) {
  const { copied, copy } = useCopied()
  const validity = usePixValidity(props.presentation.pix.expirationDate)
  const expired = validity?.expired === true
  const payload = props.presentation.pix.payload

  return (
    <div className="space-y-3">
      {expired ? (
        <div className="space-y-3 rounded-lg bg-amber-500/[0.08] p-4 ring-1 ring-amber-500/25">
          <p className="text-sm leading-6">
            Este código Pix expirou. Gere outro para pagar — o valor e a
            proposta continuam os mesmos.
          </p>
          <Button
            onClick={props.onRegenerate}
            disabled={props.isRegenerating}
            className="w-full transition-transform active:scale-[0.96]"
          >
            {props.isRegenerating ? (
              <>
                <Spinner className="mr-2" />
                Gerando novo código
              </>
            ) : (
              'Gerar novo código Pix'
            )}
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg bg-muted/40 p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.07]',
          expired && 'opacity-40',
        )}
      >
        {props.presentation.pix.qrCodeImage ? (
          <img
            src={props.presentation.pix.qrCodeImage}
            alt="QR Code Pix"
            width={224}
            height={224}
            className="size-56 rounded-md bg-white p-2.5 outline outline-1 -outline-offset-1 outline-black/10"
          />
        ) : (
          <div className="flex size-56 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
            QR indisponível
          </div>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Escaneie no app do banco ou copie o código abaixo.
        </p>
      </div>

      <div className="rounded-lg bg-muted/40 p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.07]">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <PixIcon className="size-6" />
          Pix copia e cola
        </p>
        <p className="mt-2 line-clamp-2 break-all font-mono text-xs leading-5 text-foreground/80">
          {payload ?? 'Aguardando código…'}
        </p>
        <Button
          variant="outline"
          onClick={() => copy(payload, 'Código Pix copiado')}
          disabled={!payload || expired}
          className="mt-3 w-full transition-transform active:scale-[0.96]"
        >
          <SwapIcon
            icon={Copy01Icon}
            swapped={copied}
            swappedIcon={Tick02Icon}
            className="mr-2"
          />
          {copied ? 'Copiado' : 'Copiar código Pix'}
        </Button>
      </div>

      <AutoConfirmRow
        onVerify={props.onVerify}
        isVerifying={props.isVerifying}
        note={
          validity ? (
            <span className="tabular-nums">{validity.label}</span>
          ) : null
        }
      />
    </div>
  )
}

function BoletoPanel(props: {
  presentation: Extract<PublicCheckoutPresentation, { type: 'BOLETO' }>
  onVerify: () => void
  isVerifying: boolean
}) {
  const { copied, copy } = useCopied()
  const { bankSlipUrl, identificationField, dueDate } =
    props.presentation.boleto

  return (
    <div className="space-y-3">
      <Button
        onClick={() => {
          if (bankSlipUrl) {
            window.open(bankSlipUrl, '_blank', 'noopener,noreferrer')
          }
        }}
        disabled={!bankSlipUrl}
        className="h-12 w-full text-base transition-transform active:scale-[0.96]"
      >
        <HugeiconsIcon icon={Download04Icon} className="mr-2 size-4" />
        Abrir boleto (PDF)
      </Button>

      <div className="rounded-lg bg-muted/40 p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.07]">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Linha digitável
        </p>
        <p className="mt-2 break-all font-mono text-xs leading-5 tabular-nums text-foreground/80">
          {identificationField ?? 'Linha não disponível'}
        </p>
        <Button
          variant="outline"
          onClick={() => copy(identificationField, 'Linha digitável copiada')}
          disabled={!identificationField}
          className="mt-3 w-full transition-transform active:scale-[0.96]"
        >
          <SwapIcon
            icon={Copy01Icon}
            swapped={copied}
            swappedIcon={Tick02Icon}
            className="mr-2"
          />
          {copied ? 'Copiada' : 'Copiar linha digitável'}
        </Button>
      </div>

      <AutoConfirmRow
        onVerify={props.onVerify}
        isVerifying={props.isVerifying}
        note={dueDate ? <>vence {formatDate(dueDate)}</> : null}
      />
    </div>
  )
}

const TERMINAL_ICON: Record<Exclude<TerminalState, 'PAID'>, IconSvgElement> = {
  EXPIRED: Clock01Icon,
  OVERDUE: Clock01Icon,
  REVOKED: Cancel01Icon,
  CANCELED: Cancel01Icon,
  REFUNDED: ArrowTurnBackwardIcon,
}

function TerminalPanel(props: {
  state: TerminalState
  paidAt?: string | null
}) {
  if (props.state === 'PAID') {
    const paidAt = formatDateTime(props.paidAt)
    return (
      <div className="space-y-4 rounded-lg bg-emerald-500/[0.06] p-6 text-center ring-1 ring-emerald-500/20">
        <motion.span
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/15"
          initial={{ scale: 0.25, opacity: 0, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
        >
          <HugeiconsIcon
            icon={CheckmarkBadge04Icon}
            className="size-7 text-emerald-600 dark:text-emerald-400"
          />
        </motion.span>
        <div className="space-y-1">
          <p className="text-lg font-semibold">Pagamento confirmado</p>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">
            {paidAt ? `Recebido em ${paidAt}. ` : ''}O plano já está ativo no
            seu laboratório.
          </p>
        </div>
        <Button
          className="w-full transition-transform active:scale-[0.96]"
          render={<Link to="/dashboard" />}
        >
          Entrar no CalibraFácil
          <HugeiconsIcon icon={ArrowRight02Icon} className="ml-1 size-4" />
        </Button>
      </div>
    )
  }

  const content = TERMINAL_COPY[props.state]
  return (
    <Alert>
      <HugeiconsIcon icon={TERMINAL_ICON[props.state]} className="size-4" />
      <AlertTitle>{content.title}</AlertTitle>
      <AlertDescription>{content.body}</AlertDescription>
    </Alert>
  )
}

/** B2B affordance: the person who opens the link is rarely the one who pays. */
function ForwardLink() {
  const { copied, copy } = useCopied()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 transition-transform active:scale-[0.96]"
      onClick={() => copy(window.location.href, 'Link copiado para encaminhar')}
    >
      <SwapIcon
        icon={SentIcon}
        swapped={copied}
        swappedIcon={Tick02Icon}
        className="mr-2"
      />
      {copied ? 'Link copiado' : 'Encaminhar este link para o financeiro'}
    </Button>
  )
}
