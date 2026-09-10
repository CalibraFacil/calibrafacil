import { PLANS, type PlanId } from '@calibra-facil/shared'

import type { CheckoutState, PublicCheckoutSnapshotData } from './types'

/**
 * Everything the checkout page needs to *say* about an offer, derived once
 * from the snapshot so the JSX only renders. Kept pure for the same reason the
 * forms are: what a customer is told they are buying is worth a unit test.
 */

export type CheckoutOffer = Extract<
  PublicCheckoutSnapshotData,
  { offer: object }
>['offer']

export type PaymentMethod = CheckoutOffer['paymentMethod']

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatCurrency(cents: number) {
  return BRL.format(cents / 100)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatPhone(value: string | null | undefined): string | null {
  if (!value) return null

  const digits = value.replace(/\D/g, '')
  const local =
    digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  const trimmed = local.slice(0, 11)

  if (trimmed.length < 10) return value
  if (trimmed.length === 10) {
    return trimmed.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  }
  return trimmed.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
}

export function paymentMethodLabel(method: PaymentMethod) {
  if (method === 'PIX') return 'Pix'
  if (method === 'BOLETO') return 'Boleto'
  return 'Cartão de crédito'
}

/** What the page calls the thing being bought. */
export type CheckoutSubject = {
  /** "Plano Profissional" or the first item label. */
  title: string
  /** True when the offer maps to a catalog plan we can describe. */
  planId: PlanId | null
  cycle: 'MONTHLY' | 'YEARLY' | null
}

export function describeSubject(offer: CheckoutOffer): CheckoutSubject {
  const planId = offer.basePlanId
  if (planId && planId in PLANS) {
    return {
      title: `Plano ${PLANS[planId].name}`,
      planId,
      cycle: offer.billingCycle,
    }
  }

  return {
    title: offer.items[0]?.label ?? 'Proposta comercial',
    planId: null,
    cycle: offer.billingCycle,
  }
}

/**
 * What the customer is actually buying, shown under the title. The same page
 * serves setup fees and one-off plan purchases, and calling those "Assinatura"
 * tells a customer they are signing up for a recurrence the offer does not
 * have, in the last sentence they read before paying.
 */
export function describeOfferKind(offer: CheckoutOffer): string {
  switch (offer.kind) {
    case 'PLAN_RECURRING':
      return 'Assinatura CalibraFácil'
    case 'SETUP_FEE':
      return 'Taxa de implantação CalibraFácil'
    default:
      return 'Pagamento único CalibraFácil'
  }
}

/** "por ano" / "por mês" next to the amount — only when the offer recurs. */
export function amountCadence(offer: CheckoutOffer): string | null {
  if (offer.kind !== 'PLAN_RECURRING') return null
  if (offer.billingCycle === 'YEARLY') return 'por ano'
  if (offer.billingCycle === 'MONTHLY') return 'por mês'
  return null
}

/**
 * The renewal sentence. A subscription checkout that does not say when the
 * next charge happens is the single most common reason for a chargeback, so
 * this is computed rather than left to copy.
 *
 * Counted from the offer's own due date, which is what the provider receives as
 * the first `nextDueDate` and bills every cycle from. Counting from the browser
 * clock instead would promise a date the customer is never charged on — an
 * offer is issued due a few days out, so a fresh link would already be wrong,
 * and one opened a week later more so.
 */
export function describeRenewal(
  offer: CheckoutOffer,
  now: Date = new Date(),
): string | null {
  if (offer.kind !== 'PLAN_RECURRING' || !offer.billingCycle) return null

  const firstCharge = parseDate(offer.dueDate) ?? now
  const next = new Date(firstCharge)
  if (offer.billingCycle === 'YEARLY') {
    next.setFullYear(next.getFullYear() + 1)
    return `Renova automaticamente a cada ano. Próxima cobrança em ${formatDate(
      next.toISOString(),
    )}.`
  }

  next.setMonth(next.getMonth() + 1)
  return `Renova todo mês, sem fidelidade. Próxima cobrança em ${formatDate(
    next.toISOString(),
  )}.`
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Card checkouts are hosted by the provider and the offer merely has a link
 * lifetime; Pix and boleto carry a real due date the customer must respect.
 */
export function describeDeadline(offer: CheckoutOffer): string | null {
  const validUntil = formatDate(offer.offerExpiresAt)
  const due = formatDate(offer.dueDate)

  // Only the real offer expiry. The due date is when the first charge falls
  // due, not when the link stops working — the server expires a token from
  // `offerExpiresAt` alone, so showing the due date here would announce an
  // expiry the link outlives.
  if (offer.paymentMethod === 'CREDIT_CARD') {
    return validUntil ? `Link válido até ${validUntil}` : null
  }

  return due
    ? `Vence em ${due}`
    : validUntil
      ? `Válido até ${validUntil}`
      : null
}

/** Plan facts worth repeating right before someone pays for them. */
export function planHighlights(planId: PlanId): string[] {
  const plan = PLANS[planId]
  const volume =
    plan.limits.certificates >= 999999
      ? 'Calibrações sem limite'
      : `${plan.limits.certificates.toLocaleString('pt-BR')} calibrações por mês`

  // Every line below is read from the plan's own entitlements. Written by hand
  // they drift the moment the packaging moves, and the last thing a buyer
  // should read before paying is a capability their plan will refuse.
  const highlights = [
    volume,
    'Usuários ilimitados',
    'Cálculo de incerteza, certificado assinado e trilha de auditoria',
  ]

  if (plan.entitlements.capabilities.portal) {
    highlights.push('Portal do cliente')
  }
  if (plan.entitlements.capabilities.financial) {
    highlights.push('Módulo financeiro, integração com ERP e API')
  }
  if (plan.support.includesAssistedOnboarding) {
    highlights.push(
      `Implantação assistida e resposta em ${plan.support.targetFirstResponseBusinessHours} horas úteis`,
    )
  }
  if (plan.entitlements.scale.multi_unit) {
    highlights.push('Multiunidade: filiais com dados e equipes separados')
  }
  if (plan.entitlements.capabilities.sso) {
    highlights.push('SSO corporativo')
  }

  return highlights
}

/**
 * How to describe a Pix code's validity.
 *
 * Asaas expires a dynamic code at 23:59 the same day (account without a
 * registered Pix key) or up to twelve months after the due date (with one) —
 * never in minutes. A live mm:ss countdown was therefore the wrong instrument:
 * it either never moves or shows a meaningless multi-day number. A date reads
 * correctly at both ends of that range, and only the last hour is urgent
 * enough to count down.
 */
export function describePixValidity(
  expirationDate: string | null,
  now: Date = new Date(),
): { expired: boolean; label: string } | null {
  if (!expirationDate) return null

  const expiresAt = new Date(expirationDate.replace(' ', 'T'))
  if (Number.isNaN(expiresAt.getTime())) return null

  const remainingMs = expiresAt.getTime() - now.getTime()
  if (remainingMs <= 0) return { expired: true, label: 'código expirado' }

  if (remainingMs < 60 * 60 * 1000) {
    const minutes = Math.floor(remainingMs / 60000)
    const seconds = Math.floor((remainingMs % 60000) / 1000)
    return {
      expired: false,
      label: `expira em ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    }
  }

  const sameDay = expiresAt.toDateString() === now.toDateString()
  return {
    expired: false,
    label: sameDay
      ? `vale até ${expiresAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} de hoje`
      : `vale até ${formatDate(expiresAt.toISOString())}`,
  }
}

export const STATE_LABELS: Record<CheckoutState, string> = {
  INVALID: 'Link inválido',
  EXPIRED: 'Link expirado',
  REVOKED: 'Link substituído',
  AWAITING_PAYMENT: 'Aguardando pagamento',
  PIX_READY: 'Pix gerado',
  BOLETO_READY: 'Boleto gerado',
  PAID: 'Pagamento confirmado',
  OVERDUE: 'Vencido',
  REFUNDED: 'Devolvido',
  CANCELED: 'Cancelado',
}

export type TerminalState = Exclude<
  CheckoutState,
  'INVALID' | 'AWAITING_PAYMENT' | 'PIX_READY' | 'BOLETO_READY'
>

export function isTerminalState(state: CheckoutState): state is TerminalState {
  return (
    state === 'EXPIRED' ||
    state === 'REVOKED' ||
    state === 'PAID' ||
    state === 'OVERDUE' ||
    state === 'REFUNDED' ||
    state === 'CANCELED'
  )
}

export const TERMINAL_COPY: Record<
  Exclude<TerminalState, 'PAID'>,
  { title: string; body: string }
> = {
  EXPIRED: {
    title: 'Este link expirou',
    body: 'Gere um novo link em Configurações > Assinatura.',
  },
  REVOKED: {
    title: 'Este link foi substituído',
    body: 'Use o link mais recente que você recebeu.',
  },
  OVERDUE: {
    title: 'O vencimento passou',
    body: 'Gere um novo link em Configurações > Assinatura.',
  },
  REFUNDED: {
    title: 'Pagamento devolvido',
    body: 'O valor foi estornado.',
  },
  CANCELED: {
    title: 'Proposta cancelada',
    body: 'Este link não aceita mais pagamento.',
  },
}
