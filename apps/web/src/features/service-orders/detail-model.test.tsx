import { describe, expect, it, vi } from 'vitest'

import type { ServiceOrderFinancialStatus } from '@calibra-facil/shared'
import type { ServiceOrderDetail } from './types'
import {
  buildServiceOrderDetailFormKey,
  buildServiceOrderIntakeHtml,
  buildServiceOrderTimelineItems,
  COMMUNICATION_STATUS_LABELS,
  communicationEventLabel,
  communicationStatusBadgeVariant,
  createEmptyQuoteItem,
  financialStatusBadgeVariant,
  formatCentsForMoneyInput,
  getPublicUrl,
  materialToQuoteItemPatch,
  parseMoneyToCents,
  quoteDraftItemFromApiItem,
  quoteItemsTotal,
  quoteItemTypeChangePatch,
  serviceOrderFinancialStatusSummary,
  toApiItems,
} from './detail-model'

describe('service order communications (#343)', () => {
  it('labels communication event keys in pt-BR', () => {
    expect(communicationEventLabel('nova_os')).toBe(
      'OS registrada — confirmação',
    )
    expect(communicationEventLabel('orcamento_sent:42')).toBe(
      'Orçamento enviado',
    )
    expect(communicationEventLabel('quote_approved:42')).toBe(
      'Orçamento aprovado — confirmação',
    )
    expect(communicationEventLabel('quote_rejected:42')).toBe(
      'Orçamento recusado — confirmação',
    )
    expect(communicationEventLabel('status_email:ready_for_pickup')).toBe(
      'Pronto para retirada',
    )
    expect(communicationEventLabel('status_email:something_new')).toBe(
      'Atualização de status',
    )
    // unknown namespaces fall back to the raw key rather than hiding the entry
    expect(communicationEventLabel('future_event:1')).toBe('future_event:1')
  })

  it('maps every communication status to a label and a badge variant', () => {
    const statuses = [
      'sent',
      'queued',
      'retrying',
      'failed',
      'skipped',
    ] as const
    for (const status of statuses) {
      expect(COMMUNICATION_STATUS_LABELS[status]).toBeTruthy()
      expect(communicationStatusBadgeVariant(status)).toBeTruthy()
    }
    expect(communicationStatusBadgeVariant('failed')).toBe('destructive')
    expect(communicationStatusBadgeVariant('sent')).toBe('default')
  })
})

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
      materialId: null,
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
        materialId: null,
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

  it('REQ-SOPICK-004: toApiItems carries materialId (number and null) through the payload', () => {
    expect(
      toApiItems([
        {
          id: 'a',
          type: 'part',
          description: 'Correia',
          quantity: '2',
          unit: 'un',
          unitPrice: '15,00',
          materialId: 42,
        },
        {
          id: 'b',
          type: 'part',
          description: 'Peça avulsa',
          quantity: '1',
          unit: 'un',
          unitPrice: '5,00',
          materialId: null,
        },
        {
          id: 'c',
          type: 'service',
          description: 'Mão de obra',
          quantity: '1',
          unit: 'un',
          unitPrice: '30,00',
        },
      ]).map((item) => ({
        description: item.description,
        materialId: item.materialId,
      })),
    ).toEqual([
      { description: 'Correia', materialId: 42 },
      { description: 'Peça avulsa', materialId: null },
      { description: 'Mão de obra', materialId: null },
    ])
  })

  it('REQ-SOPICK-004: round-trips an API item into a draft item preserving materialId', () => {
    const draftWithMaterial = quoteDraftItemFromApiItem({
      id: 7,
      type: 'part',
      description: 'Rolamento 6203',
      quantity: 3,
      unit: 'pç',
      unitPriceCents: 123456,
      totalPriceCents: 370368,
      materialId: 91,
    })
    expect(draftWithMaterial).toEqual({
      id: '7',
      type: 'part',
      description: 'Rolamento 6203',
      quantity: '3',
      unit: 'pç',
      unitPrice: '1.234,56',
      materialId: 91,
    })
    // The draft round-trips back to an API payload keeping the catalog reference.
    expect(toApiItems([draftWithMaterial])[0].materialId).toBe(91)

    const draftFreeForm = quoteDraftItemFromApiItem({
      id: 8,
      type: 'part',
      description: 'Peça livre',
      quantity: 1,
      unit: 'un',
      unitPriceCents: 5000,
      totalPriceCents: 5000,
    })
    expect(draftFreeForm.materialId).toBeNull()
    expect(toApiItems([draftFreeForm])[0].materialId).toBeNull()
  })

  it('REQ-SOPICK-003: changing a row type away from "part" resets materialId', () => {
    expect(quoteItemTypeChangePatch('part')).toEqual({ type: 'part' })
    expect(quoteItemTypeChangePatch('service')).toEqual({
      type: 'service',
      materialId: null,
    })
    expect(quoteItemTypeChangePatch('freight')).toEqual({
      type: 'freight',
      materialId: null,
    })
  })

  it('REQ-SOPICK-002: builds a quote-item prefill patch from a selected material', () => {
    expect(
      materialToQuoteItemPatch({
        id: 5,
        name: 'Correia dentada',
        description: null,
        sku: 'CB-100',
        unit: 'pç',
        unitCostCents: 800,
        unitPriceCents: 1990,
        controlsStock: true,
        stockQuantity: null,
        stockSyncedAt: null,
        isActive: true,
        createdAt: null,
        updatedAt: null,
      }),
    ).toEqual({
      materialId: 5,
      description: 'Correia dentada',
      unit: 'pç',
      unitPrice: '19,90',
    })
  })

  it('REQ-SOPICK-002: prefill leaves the price blank when the material has no list price', () => {
    expect(formatCentsForMoneyInput(null)).toBe('')
    expect(formatCentsForMoneyInput(undefined)).toBe('')
    expect(formatCentsForMoneyInput(1990)).toBe('19,90')
    expect(formatCentsForMoneyInput(123456)).toBe('1.234,56')
    expect(
      materialToQuoteItemPatch({
        id: 6,
        name: 'Item sem preço',
        description: null,
        sku: null,
        unit: 'un',
        unitCostCents: null,
        unitPriceCents: null,
        controlsStock: false,
        stockQuantity: null,
        stockSyncedAt: null,
        isActive: true,
        createdAt: null,
        updatedAt: null,
      }).unitPrice,
    ).toBe('')
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

  it('maps financial status to provider-neutral labels', () => {
    expect(financialStatusBadgeVariant('OVERDUE')).toBe('destructive')
    expect(financialStatusBadgeVariant('PAID')).toBe('default')
    expect(financialStatusBadgeVariant('STATUS_UNAVAILABLE')).toBe('outline')

    const summary = serviceOrderFinancialStatusSummary({
      serviceOrderId: 1,
      serviceOrderNumber: 'OS-1',
      status: 'AWAITING_PAYMENT',
      label: 'Aguardando confirmação de pagamento',
      description: 'Sincronizado',
      readinessStatus: 'SENT',
      blockers: [],
      amountCents: 50000,
      currency: 'BRL',
      billingDocument: {
        id: 10,
        documentNumber: 'FIN-10',
        status: 'ISSUED',
        exportStatus: 'EXPORTED',
        issuedAt: '2026-05-20T00:00:00.000Z',
        dueDate: '2026-06-20T00:00:00.000Z',
        totalCents: 50000,
        currency: 'BRL',
      },
      installments: [
        {
          id: 70,
          installmentNumber: 1,
          status: 'OPEN',
          label: 'Aguardando pagamento',
          amountCents: 30000,
          currency: 'BRL',
          dueDate: '2026-06-20T00:00:00.000Z',
          paidAt: null,
          paymentMethod: null,
        },
        {
          id: 71,
          installmentNumber: 2,
          status: 'OVERDUE',
          label: 'Em atraso',
          amountCents: 20000,
          currency: 'BRL',
          dueDate: '2026-06-21T00:00:00.000Z',
          paidAt: null,
          paymentMethod: null,
        },
      ],
      installmentsSummary: {
        total: 2,
        totalCents: 50000,
        paidCents: 0,
        openCents: 50000,
        overdueCents: 20000,
        paidCount: 0,
        openCount: 1,
        overdueCount: 1,
        voidCount: 0,
      },
      receipts: [
        {
          id: 80,
          installmentId: 70,
          receivedAt: '2026-06-01T00:00:00.000Z',
          amountCents: 10000,
          paymentMethod: 'PIX',
          reference: null,
        },
      ],
      fiscalDocument: {
        availability: 'AVAILABLE',
        label: 'Documento fiscal disponível',
        number: '123',
        issuedAt: '2026-05-20T00:00:00.000Z',
        accessKey: null,
        xmlAvailable: false,
        consultationOnly: true,
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
      },
      freshness: {
        status: 'fresh',
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
        label: 'Sincronizado',
      },
      providerEvidence: null,
    })

    expect(summary).toMatchObject({
      fiscalLabel: 'Documento fiscal disponível',
      totalLabel: 'R$ 500,00',
      openLabel: 'R$ 300,00',
      overdueCents: 20000,
      overdueLabel: 'R$ 200,00',
      receivedLabel: 'R$ 100,00',
      evidenceLabel: 'Sincronizado',
      evidenceReconnectPath: null,
    })
  })

  it('keeps reconnect labels generic and avoids duplicate stale timestamps', () => {
    const reconnectSummary = serviceOrderFinancialStatusSummary({
      ...financialStatusFixture(),
      providerEvidence: {
        label: 'Reconecte Conta Azul para atualizar o status',
        integrationState: 'disconnected',
        reconnectPath: '/dashboard/settings/integrations#financial-erp',
      },
    })

    expect(reconnectSummary).toMatchObject({
      evidenceLabel: 'Reconectar',
      evidenceReconnectPath: '/dashboard/settings/integrations#financial-erp',
    })

    const staleSummary = serviceOrderFinancialStatusSummary({
      ...financialStatusFixture(),
      freshness: {
        status: 'stale',
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
        label: 'Status desatualizado',
      },
      providerEvidence: {
        label: 'Conta Azul sem atualização recente',
        integrationState: 'connected',
        reconnectPath: null,
      },
    })

    expect(staleSummary.evidenceLabel).toBe(
      'Conta Azul sem atualização recente',
    )
  })
})

function financialStatusFixture(): ServiceOrderFinancialStatus {
  return {
    serviceOrderId: 1,
    serviceOrderNumber: 'OS-1',
    status: 'AWAITING_PAYMENT' as const,
    label: 'Aguardando confirmação de pagamento',
    description: 'Sincronizado',
    readinessStatus: 'SENT' as const,
    blockers: [],
    amountCents: 50000,
    currency: 'BRL',
    billingDocument: {
      id: 10,
      documentNumber: 'FIN-10',
      status: 'ISSUED' as const,
      exportStatus: 'EXPORTED' as const,
      issuedAt: '2026-05-20T00:00:00.000Z',
      dueDate: '2026-06-20T00:00:00.000Z',
      totalCents: 50000,
      currency: 'BRL',
    },
    installments: [],
    installmentsSummary: {
      total: 0,
      totalCents: 0,
      paidCents: 0,
      openCents: 0,
      overdueCents: 0,
      paidCount: 0,
      openCount: 0,
      overdueCount: 0,
      voidCount: 0,
    },
    receipts: [],
    fiscalDocument: {
      availability: 'NONE' as const,
      label: 'Sem documento fiscal vinculado',
      number: null,
      issuedAt: null,
      accessKey: null,
      xmlAvailable: false,
      consultationOnly: true,
      lastSyncedAt: null,
    },
    freshness: {
      status: 'fresh' as const,
      lastSyncedAt: '2026-05-20T00:00:00.000Z',
      label: 'Sincronizado',
    },
    providerEvidence: null,
  }
}

function serviceOrderDetail(): ServiceOrderDetail {
  return {
    id: 1,
    serviceOrderNumber: 'OS-1',
    customerId: 1,
    assetId: 1,
    status: 'opened',
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
