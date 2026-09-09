import { describe, expect, it } from 'vitest'

import { PLANS } from '@calibra-facil/shared'
import {
  amountCadence,
  describePixValidity,
  describeDeadline,
  describeRenewal,
  describeSubject,
  formatPhone,
  planHighlights,
  type CheckoutOffer,
} from './checkout-model'

function offer(overrides: Partial<CheckoutOffer> = {}): CheckoutOffer {
  return {
    id: 'offer-1',
    status: 'PENDING_PAYMENT',
    kind: 'PLAN_RECURRING',
    basePlanId: 'PROFESSIONAL',
    billingCycle: 'YEARLY',
    paymentMethod: 'CREDIT_CARD',
    providerMode: 'CHECKOUT',
    currency: 'BRL',
    totalAmount: 718800,
    recurringAmount: 718800,
    dueDate: '2026-09-11T00:00:00.000Z',
    offerExpiresAt: null,
    issuedAt: null,
    paidAt: null,
    customerVisibleDescription: null,
    items: [
      {
        id: 1,
        type: 'PLAN',
        label: 'Plano Profissional — assinatura anual',
        description: null,
        quantity: 1,
        unitAmount: 718800,
        totalAmount: 718800,
      },
    ],
    seller: {
      name: 'Laboratório Exemplo',
      cnpj: '00.000.000/0001-00',
      email: null,
      phone: null,
      website: null,
      city: null,
      state: null,
    },
    payer: { name: null, email: null, phone: null, taxId: null },
    ...overrides,
  }
}

describe('checkout model', () => {
  it('names the plan when the offer maps to the catalog', () => {
    expect(describeSubject(offer())).toEqual({
      title: 'Plano Profissional',
      planId: 'PROFESSIONAL',
      cycle: 'YEARLY',
    })
  })

  it('falls back to the first item for a bespoke offer', () => {
    expect(describeSubject(offer({ basePlanId: null })).title).toBe(
      'Plano Profissional — assinatura anual',
    )
  })

  it('states the cadence and the next charge for a subscription', () => {
    const now = new Date('2026-09-08T12:00:00.000Z')

    expect(amountCadence(offer())).toBe('por ano')
    expect(describeRenewal(offer(), now)).toContain('a cada ano')
    expect(describeRenewal(offer(), now)).toContain('2027')

    const monthly = offer({ billingCycle: 'MONTHLY' })
    expect(amountCadence(monthly)).toBe('por mês')
    expect(describeRenewal(monthly, now)).toContain('sem fidelidade')
    expect(describeRenewal(monthly, now)).toContain('outubro')
  })

  it('counts the renewal from the offer schedule, not the browser clock', () => {
    // The offer is due 2026-09-11 and that date is what the provider bills the
    // next cycle from. Reading the clock instead would print 2026-09-08 + a
    // year and quietly promise a charge on a day nothing happens.
    const now = new Date('2026-09-08T12:00:00.000Z')

    expect(describeRenewal(offer(), now)).toContain('11 de setembro de 2027')
    expect(describeRenewal(offer({ billingCycle: 'MONTHLY' }), now)).toContain(
      '11 de outubro de 2026',
    )
  })

  it('says nothing about renewal for a one-off charge', () => {
    const setup = offer({ kind: 'SETUP_FEE', billingCycle: null })
    expect(amountCadence(setup)).toBeNull()
    expect(describeRenewal(setup)).toBeNull()
  })

  it('treats a card link as valid-until and a boleto as due', () => {
    expect(
      describeDeadline(offer({ offerExpiresAt: '2026-10-01T00:00:00.000Z' })),
    ).toMatch(/^Link válido até/)
    expect(describeDeadline(offer({ paymentMethod: 'BOLETO' }))).toMatch(
      /^Vence em/,
    )
  })

  it('says nothing about a card link with no expiry of its own', () => {
    // The due date is when the first charge falls due, not when the link dies:
    // the server only ever expires a token from offerExpiresAt, so announcing
    // the due date would promise an expiry the link outlives.
    expect(describeDeadline(offer({ offerExpiresAt: null }))).toBeNull()
  })

  it('never promises the portal on a plan that refuses it', () => {
    // Essencial has no `portal` entitlement. Telling a buyer otherwise in the
    // last sentence before payment is the worst place to be wrong.
    expect(planHighlights('STANDARD').join(' ')).not.toContain('Portal')
    expect(planHighlights('PROFESSIONAL').join(' ')).toContain('Portal')
  })

  it('does not bundle Enterprise-only SSO into Escala', () => {
    // Escala has multi_unit and not sso; the two used to share one line.
    const escala = planHighlights('ADVANCED').join(' ')
    expect(escala).toContain('Multiunidade')
    expect(escala).not.toContain('SSO')
    expect(planHighlights('ENTERPRISE').join(' ')).toContain('SSO')
  })

  it('repeats the plan facts a buyer is paying for', () => {
    const lines = planHighlights('PROFESSIONAL')
    // From the plan, not written down here: the ladder gets retuned.
    expect(lines[0]).toBe(
      `${PLANS.PROFESSIONAL.limits.certificates.toLocaleString('pt-BR')} calibrações por mês`,
    )
    expect(lines).toContain('Usuários ilimitados')
    expect(lines.some((line) => line.includes('financeiro'))).toBe(true)
    expect(
      planHighlights('STANDARD').some((l) => l.includes('financeiro')),
    ).toBe(false)
    expect(
      planHighlights('ADVANCED').some((l) => l.includes('Implantação')),
    ).toBe(true)
  })

  it('formats Brazilian phones with or without the country code', () => {
    expect(formatPhone('5551900000000')).toBe('(51) 90000-0000')
    expect(formatPhone('5133334444')).toBe('(51) 3333-4444')
    expect(formatPhone('123')).toBe('123')
  })
})

describe('describePixValidity', () => {
  const now = new Date('2026-09-08T21:00:00.000Z')

  it('says nothing when Asaas sends no expiry', () => {
    expect(describePixValidity(null, now)).toBeNull()
    expect(describePixValidity('nunca', now)).toBeNull()
  })

  it('reports an expired code', () => {
    const result = describePixValidity('2026-09-08 20:59:00', now)
    expect(result).toEqual({ expired: true, label: 'código expirado' })
  })

  // Asaas expires same-day at 23:59 or up to twelve months out — a stopwatch
  // was the wrong instrument for both ends of that range.
  it('reads as a time for the rest of today', () => {
    const result = describePixValidity('2026-09-08 23:59:59', now)
    expect(result?.expired).toBe(false)
    expect(result?.label).toMatch(/^vale até \d{2}:\d{2} de hoje$/)
  })

  it('reads as a date when it is months away', () => {
    const result = describePixValidity('2027-09-08 23:59:59', now)
    expect(result?.expired).toBe(false)
    expect(result?.label).toContain('vale até')
    expect(result?.label).toContain('2027')
  })

  it('counts down only in the final hour', () => {
    const result = describePixValidity('2026-09-08T21:29:30.000Z', now)
    expect(result?.label).toBe('expira em 29:30')
  })
})
