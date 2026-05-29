import { describe, expect, it } from 'vitest'

import {
  agreementTone,
  billingDocumentTone,
  billingReadinessTone,
  exportStatusTone,
  installmentTone,
} from '@/features/finance/finance-display'

describe('finance status → SignalTone', () => {
  it('maps billing document status to the expected tone', () => {
    expect(billingDocumentTone('PAID')).toBe('ok')
    expect(billingDocumentTone('OVERDUE')).toBe('critical')
    expect(billingDocumentTone('ISSUED')).toBe('info')
    expect(billingDocumentTone('DRAFT')).toBe('neutral')
    expect(billingDocumentTone('VOID')).toBe('neutral')
  })

  it('maps installment status to the expected tone', () => {
    expect(installmentTone('PAID')).toBe('ok')
    expect(installmentTone('OVERDUE')).toBe('critical')
    expect(installmentTone('OPEN')).toBe('info')
    expect(installmentTone('VOID')).toBe('neutral')
  })

  it('maps export status to the expected tone', () => {
    expect(exportStatusTone('EXPORTED')).toBe('ok')
    expect(exportStatusTone('FAILED')).toBe('critical')
    expect(exportStatusTone('PENDING')).toBe('warning')
    expect(exportStatusTone('NOT_EXPORTED')).toBe('neutral')
  })

  it('maps commercial agreement status to the expected tone', () => {
    expect(agreementTone('ACTIVE')).toBe('ok')
    expect(agreementTone('CANCELED')).toBe('critical')
    expect(agreementTone('EXPIRED')).toBe('warning')
    expect(agreementTone('DRAFT')).toBe('neutral')
  })

  it('maps billing-readiness status to the expected tone', () => {
    expect(billingReadinessTone('SENT')).toBe('ok')
    expect(billingReadinessTone('BLOCKED')).toBe('critical')
    expect(billingReadinessTone('READY')).toBe('info')
    expect(billingReadinessTone('BILLED')).toBe('neutral')
  })
})
