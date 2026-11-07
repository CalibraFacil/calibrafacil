import { describe, expect, it } from 'vitest'

import {
  BILLING_DOCUMENT_EXPORT_STATUS,
  BILLING_DOCUMENT_STATUS,
  COMMERCIAL_AGREEMENT_STATUS,
  RECEIVABLE_INSTALLMENT_STATUS,
} from '@calibra-facil/shared'
import {
  billingDocumentToneOf,
  billingReadinessTone,
  exportStatusToneOf,
  installmentToneOf,
} from '@/features/finance/finance-display'

describe('finance status → SignalTone', () => {
  it('maps billing document status to the expected tone', () => {
    expect(BILLING_DOCUMENT_STATUS.tone('PAID')).toBe('ok')
    expect(BILLING_DOCUMENT_STATUS.tone('OVERDUE')).toBe('critical')
    expect(BILLING_DOCUMENT_STATUS.tone('ISSUED')).toBe('info')
    expect(BILLING_DOCUMENT_STATUS.tone('DRAFT')).toBe('neutral')
    expect(BILLING_DOCUMENT_STATUS.tone('VOID')).toBe('neutral')
  })

  it('maps installment status to the expected tone', () => {
    expect(RECEIVABLE_INSTALLMENT_STATUS.tone('PAID')).toBe('ok')
    expect(RECEIVABLE_INSTALLMENT_STATUS.tone('OVERDUE')).toBe('critical')
    expect(RECEIVABLE_INSTALLMENT_STATUS.tone('OPEN')).toBe('info')
    expect(RECEIVABLE_INSTALLMENT_STATUS.tone('VOID')).toBe('neutral')
  })

  it('maps export status to the expected tone', () => {
    expect(BILLING_DOCUMENT_EXPORT_STATUS.tone('EXPORTED')).toBe('ok')
    expect(BILLING_DOCUMENT_EXPORT_STATUS.tone('FAILED')).toBe('critical')
    expect(BILLING_DOCUMENT_EXPORT_STATUS.tone('NOT_EXPORTED')).toBe('neutral')
  })

  it('maps commercial agreement status to the expected tone', () => {
    expect(COMMERCIAL_AGREEMENT_STATUS.tone('ACTIVE')).toBe('ok')
    expect(COMMERCIAL_AGREEMENT_STATUS.tone('CANCELED')).toBe('critical')
    expect(COMMERCIAL_AGREEMENT_STATUS.tone('EXPIRED')).toBe('warning')
    expect(COMMERCIAL_AGREEMENT_STATUS.tone('DRAFT')).toBe('neutral')
  })

  it('maps billing-readiness status to the expected tone', () => {
    expect(billingReadinessTone('SENT')).toBe('ok')
    expect(billingReadinessTone('BLOCKED')).toBe('critical')
    expect(billingReadinessTone('READY')).toBe('info')
    expect(billingReadinessTone('BILLED')).toBe('neutral')
  })

  it('degrades an unknown status string to neutral', () => {
    expect(billingDocumentToneOf('PAID')).toBe('ok')
    expect(billingDocumentToneOf('MISSING')).toBe('neutral')
    expect(installmentToneOf('OVERDUE')).toBe('critical')
    expect(installmentToneOf('MISSING')).toBe('neutral')
    expect(exportStatusToneOf('FAILED')).toBe('critical')
    expect(exportStatusToneOf('MISSING')).toBe('neutral')
  })
})
