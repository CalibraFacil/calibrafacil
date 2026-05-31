import { describe, expect, it } from 'vitest'

import { parseServiceOrderForm, type ServiceOrderFormData } from './forms'

describe('service order feature forms', () => {
  it('builds service order intake payloads', () => {
    const result = parseServiceOrderForm({
      ...validServiceOrderForm(),
      intakeType: 'carrier',
      carrierName: '  Transportes ACME  ',
      evaluationFeeCents: '12,34',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        customerId: 10,
        assetId: 20,
        intakeType: 'carrier',
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
    priority: 'normal',
    deliveryMethod: 'pickup_at_lab',
    claimedDefect: 'Nao liga',
    intakeCondition: 'Sem danos aparentes',
    accessories: '',
    oldSealNumber: '',
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
