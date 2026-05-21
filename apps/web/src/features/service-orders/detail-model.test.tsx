import { describe, expect, it, vi } from 'vitest'

import type { ServiceOrderDetail } from './types'
import {
  buildServiceOrderDetailFormKey,
  buildServiceOrderIntakeHtml,
  buildServiceOrderTimelineItems,
  createEmptyQuoteItem,
  getPublicUrl,
  parseMoneyToCents,
  quoteItemsTotal,
  toApiItems,
} from './detail-model'

describe('service order detail model', () => {
  it('parses Brazilian money strings into cents', () => {
    expect(parseMoneyToCents('1.234,56')).toBe(123456)
    expect(parseMoneyToCents('12,34')).toBe(1234)
    expect(Number.isNaN(parseMoneyToCents('abc'))).toBe(true)
  })

  it('creates quote draft items and totals valid rows', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001',
    )

    expect(createEmptyQuoteItem('part')).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'part',
      description: '',
      quantity: '1',
      unit: 'un',
      unitPrice: '',
    })

    expect(
      quoteItemsTotal([
        {
          id: 'a',
          type: 'service',
          description: 'Reparo',
          quantity: '2',
          unit: 'un',
          unitPrice: '10,50',
        },
        {
          id: 'b',
          type: 'part',
          description: 'Peça',
          quantity: 'invalid',
          unit: 'un',
          unitPrice: '10,00',
        },
      ]),
    ).toBe(2100)
  })

  it('normalizes quote draft items for the API and rejects invalid rows', () => {
    expect(
      toApiItems([
        {
          id: 'a',
          type: 'service',
          description: '  Reparo  ',
          quantity: '1,5',
          unit: '',
          unitPrice: '20,00',
        },
      ]),
    ).toEqual([
      {
        type: 'service',
        description: 'Reparo',
        quantity: 1.5,
        unit: 'un',
        unitPriceCents: 2000,
        taxable: true,
        warrantyCovered: false,
      },
    ])

    expect(() =>
      toApiItems([
        {
          id: 'a',
          type: 'service',
          description: '',
          quantity: '1',
          unit: 'un',
          unitPrice: '20,00',
        },
      ]),
    ).toThrow('Informe a descrição de todos os itens.')
  })

  it('maps service order events to timeline items', () => {
    const items = buildServiceOrderTimelineItems([
      {
        id: 1,
        eventType: 'service_order.quote_approved_by_client',
        actorType: 'portal_user',
        actorName: null,
        createdAt: '2026-05-20T10:00:00.000Z',
      },
      {
        id: 2,
        eventType: 'custom.event',
        actorType: 'system',
        actorName: null,
        createdAt: '2026-05-20T11:00:00.000Z',
      },
    ])

    expect(items).toMatchObject([
      {
        id: '1',
        title: 'Orçamento aprovado pelo cliente',
        actor: 'Cliente no portal',
        status: 'completed',
      },
      {
        id: '2',
        title: 'custom.event',
        actor: 'Sistema',
        status: 'completed',
      },
    ])
  })

  it('extracts public URLs from flat and nested responses', () => {
    expect(getPublicUrl({ publicUrl: 'https://example.test/a.pdf' })).toBe(
      'https://example.test/a.pdf',
    )
    expect(
      getPublicUrl({ data: { publicUrl: 'https://example.test/b.pdf' } }),
    ).toBe('https://example.test/b.pdf')
    expect(getPublicUrl({ data: {} })).toBeNull()
  })

  it('builds stable form keys from workflow record ids', () => {
    expect(
      buildServiceOrderDetailFormKey({
        ...serviceOrderDetail(),
        evaluations: [
          {
            id: 10,
            diagnosis: 'Falha elétrica',
            recommendedAction: 'repair',
            requiresQuote: true,
            requiresClientApproval: true,
            calibrationRecommended: false,
            evaluatedAt: '2026-05-20T10:00:00.000Z',
          },
        ],
        execution: {
          id: 20,
          startedAt: '2026-05-20T11:00:00.000Z',
          calibrationRequiredAfterRepair: false,
          items: [],
        },
        deliveryDocuments: [
          {
            id: 30,
            documentNumber: 'ENT-1',
            version: 1,
          },
        ],
      }),
    ).toBe('1:10:20:30')
  })

  it('builds the intake preview HTML from the service order snapshot', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = buildServiceOrderIntakeHtml(
      {
        ...serviceOrderDetail(),
        priority: 'warranty',
        organizationName: 'Lab Calibra',
        organizationStreet: 'Rua Um',
        organizationNumber: '123',
        organizationCity: 'Curitiba',
        organizationState: 'PR',
        assetSnapshot: {
          assetName: 'Balança snapshot',
          assetType: 'Balança',
          manufacturer: 'ACME',
          serialNumber: 'SN-SNAPSHOT',
        },
      },
      'https://app.example.test',
    )

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Lab Calibra')
    expect(html).toContain('Garantia')
    expect(html).toContain('Balança snapshot')
    consoleError.mockRestore()
  })
})

function serviceOrderDetail(): ServiceOrderDetail {
  return {
    id: 1,
    serviceOrderNumber: 'OS-1',
    priority: 'normal',
    statusLabel: 'Aberta',
    customerName: 'Cliente',
    assetName: 'Balança',
    assetTag: 'BAL-1',
    claimedDefect: 'Não liga',
    intakeCondition: 'Sem danos aparentes',
    openedAt: '2026-05-20T09:00:00.000Z',
    evaluations: [],
    quotes: [],
    execution: null,
    deliveryDocuments: [],
    events: [],
  }
}
