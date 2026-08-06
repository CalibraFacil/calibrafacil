import { describe, expect, it } from 'vitest'

import {
  isServiceStartDirty,
  parseServiceOrderForm,
  serviceStartDraftFromIso,
  serviceStartDraftToIso,
  type ServiceOrderFormData,
} from './forms'

describe('evaluation start date/time draft', () => {
  it('splits a stored instant into a local date and HH:mm', () => {
    const iso = new Date(2026, 4, 11, 9, 5).toISOString()
    const draft = serviceStartDraftFromIso(iso)

    expect(draft.time).toBe('09:05')
    expect(draft.date?.getFullYear()).toBe(2026)
    expect(draft.date?.getMonth()).toBe(4)
    expect(draft.date?.getDate()).toBe(11)
  })

  it('round-trips a draft back to the same instant', () => {
    const iso = new Date(2026, 4, 11, 14, 30).toISOString()

    expect(serviceStartDraftToIso(serviceStartDraftFromIso(iso))).toBe(iso)
  })

  it('treats an empty or unparseable value as no date', () => {
    expect(serviceStartDraftFromIso(null)).toEqual({
      date: undefined,
      time: '',
    })
    expect(serviceStartDraftFromIso('not-a-date')).toEqual({
      date: undefined,
      time: '',
    })
    expect(
      serviceStartDraftToIso({ date: undefined, time: '09:00' }),
    ).toBeNull()
  })

  it('defaults a blank time to midnight rather than dropping the date', () => {
    const iso = serviceStartDraftToIso({
      date: new Date(2026, 4, 11, 18, 45),
      time: '',
    })

    expect(iso).toBe(new Date(2026, 4, 11, 0, 0, 0, 0).toISOString())
  })

  it('reports dirtiness against the stored value, ignoring ISO formatting', () => {
    const stored = new Date(2026, 4, 11, 9, 0).toISOString()

    expect(isServiceStartDirty(serviceStartDraftFromIso(stored), stored)).toBe(
      false,
    )
    expect(
      isServiceStartDirty(
        { date: new Date(2026, 4, 11), time: '09:30' },
        stored,
      ),
    ).toBe(true)
    // Clearing a value that was set is a change worth saving.
    expect(isServiceStartDirty({ date: undefined, time: '' }, stored)).toBe(
      true,
    )
    expect(isServiceStartDirty({ date: undefined, time: '' }, null)).toBe(false)
  })
})

describe('service order feature forms', () => {
  it('builds service order intake payloads', () => {
    const result = parseServiceOrderForm({
      ...validServiceOrderForm(),
      intakeType: 'carrier',
      isExternalService: true,
      carrierName: '  Transportes ACME  ',
      evaluationFeeCents: '12,34',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        customerId: 10,
        assetId: 20,
        intakeType: 'carrier',
        isExternalService: true,
        priority: 'normal',
        deliveryMethod: 'pickup_at_lab',
        claimedDefect: 'Nao liga',
        intakeCondition: 'Sem danos aparentes',
        carrierName: 'Transportes ACME',
        thirdPartyName: null,
        evaluationFeeCents: 1234,
      },
    })
  })

  it('maps required intake fields to form errors', () => {
    const result = parseServiceOrderForm({
      ...validServiceOrderForm(),
      customerId: null,
      assetId: null,
      claimedDefect: '',
      intakeCondition: '',
    })

    expect(result).toEqual({
      success: false,
      message: 'Selecione um cliente',
      fieldErrors: [
        { field: 'customerId', message: 'Selecione um cliente' },
        { field: 'assetId', message: 'Selecione um instrumento' },
        { field: 'claimedDefect', message: 'Informe o defeito reclamado' },
        {
          field: 'intakeCondition',
          message: 'Informe a condição aparente de recebimento',
        },
      ],
    })
  })

  it('requires the conditional carrier name', () => {
    const result = parseServiceOrderForm({
      ...validServiceOrderForm(),
      intakeType: 'carrier',
      carrierName: '',
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Informe a transportadora',
      fieldErrors: [
        { field: 'carrierName', message: 'Informe a transportadora' },
      ],
    })
  })
})

function validServiceOrderForm(): ServiceOrderFormData {
  return {
    customerId: 10,
    assetId: 20,
    intakeType: 'counter',
    isExternalService: false,
    priority: 'normal',
    deliveryMethod: 'pickup_at_lab',
    claimedDefect: 'Nao liga',
    intakeCondition: 'Sem danos aparentes',
    accessories: '',
    removedSealingMarkNumber: '',
    invoiceRemittanceNumber: '',
    invoiceRemittanceKey: '',
    carrierName: '',
    carrierDocument: '',
    thirdPartyName: '',
    thirdPartyDocument: '',
    thirdPartyPhone: '',
    clientVisibleNotes: '',
    internalNotes: '',
    evaluationFeeCents: '',
  }
}
