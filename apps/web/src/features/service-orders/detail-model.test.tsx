import { describe, expect, it, vi } from 'vitest'

import { SERVICE_ORDER_EVENT_TYPES } from '@calibra-facil/shared'
import type { ServiceOrderFinancialStatus } from '@calibra-facil/shared'
import type { ServiceOrderDetail } from './types'
import {
  buildServiceOrderDetailFormKey,
  buildServiceOrderIntakeHtml,
  buildServiceOrderStageAffordances,
  buildServiceOrderTimelineItems,
  buildServiceOrderWorkflowStages,
  COMMUNICATION_STATUS_LABELS,
  communicationEventLabel,
  communicationStatusBadgeVariant,
  createEmptyQuoteItem,
  financialStatusBadgeVariant,
  formatCentsForMoneyInput,
  getPublicUrl,
  isServiceOrderLifecycleError,
  materialToQuoteItemPatch,
  parseMoneyToCents,
  quoteDraftItemFromApiItem,
  quoteItemLineTotal,
  quoteItemsTotal,
  quoteItemTypeChangePatch,
  serviceOrderActionErrorMessage,
  serviceOrderEventLabel,
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

  it('gives every canonical event type a pt-BR label, never the raw key', () => {
    for (const eventType of SERVICE_ORDER_EVENT_TYPES) {
      const label = serviceOrderEventLabel(eventType)
      expect(label).not.toBe(eventType)
      expect(label).not.toMatch(/^service_order\./)
      expect(label.trim().length).toBeGreaterThan(0)
    }

    // The regression that started this: the customer-side events were absent.
    expect(serviceOrderEventLabel('service_order.public_link_viewed')).toBe(
      'Link público acessado',
    )
    expect(serviceOrderEventLabel('service_order.portal_viewed')).toBe(
      'Visualizada no portal do cliente',
    )
  })

  it('falls back to the raw key for an event type this build does not know', () => {
    expect(serviceOrderEventLabel('service_order.future_thing')).toBe(
      'service_order.future_thing',
    )
  })

  it('gives customer reads and outbound email their own timeline icons', () => {
    const [view, email, generic] = buildServiceOrderTimelineItems([
      {
        id: 1,
        eventType: 'service_order.public_link_viewed',
        actorType: 'public_token',
        actorName: null,
        createdAt: '2026-05-20T10:00:00.000Z',
      },
      {
        id: 2,
        eventType: 'service_order.email_sent',
        actorType: 'system',
        actorName: null,
        createdAt: '2026-05-20T11:00:00.000Z',
      },
      {
        id: 3,
        eventType: 'service_order.created',
        actorType: 'lab_user',
        actorName: 'Pedro',
        createdAt: '2026-05-20T12:00:00.000Z',
      },
    ])

    expect(view.title).toBe('Link público acessado')
    expect(view.actor).toBe('Link público')
    expect(view.icon).not.toBe(generic.icon)
    expect(email.icon).not.toBe(generic.icon)
    expect(email.icon).not.toBe(view.icon)
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
    // The printed lab copy names this field exactly as the dashboard does, so
    // the form a technician fills in matches the screen they fill it from.
    expect(html).toContain('Início da avaliação')
    expect(html).not.toContain('Início do serviço')
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

type StagesInput = Pick<
  ServiceOrderDetail,
  'evaluations' | 'quotes' | 'execution' | 'deliveredAt'
>

function stagesInput(overrides: Partial<StagesInput> = {}): StagesInput {
  return {
    evaluations: [],
    quotes: [],
    execution: null,
    deliveredAt: null,
    ...overrides,
  }
}

function evaluation(): ServiceOrderDetail['evaluations'][number] {
  return {
    id: 1,
    diagnosis: 'Célula de carga descalibrada',
    recommendedAction: 'repair',
    requiresQuote: true,
    requiresClientApproval: true,
    calibrationRecommended: false,
    evaluatedAt: '2026-05-20T10:00:00.000Z',
  }
}

function quote(
  overrides: Partial<ServiceOrderDetail['quotes'][number]> = {},
): ServiceOrderDetail['quotes'][number] {
  return {
    id: 1,
    status: 'draft',
    totalCents: 25000,
    version: 1,
    items: [],
    ...overrides,
  }
}

function runningExecution(
  finishedAt: string | null,
): NonNullable<ServiceOrderDetail['execution']> {
  return {
    id: 7,
    startedAt: '2026-05-21T09:00:00.000Z',
    finishedAt,
    calibrationRequiredAfterRepair: false,
    items: [],
  }
}

describe('service order workflow stages', () => {
  it('marks the first unfinished stage as current and the rest as pending', () => {
    const stages = buildServiceOrderWorkflowStages(stagesInput())

    expect(stages.map((stage) => stage.state)).toEqual([
      'current',
      'pending',
      'pending',
      'pending',
    ])
    expect(stages.map((stage) => stage.hint)).toEqual([
      'Pendente',
      'Sem orçamento',
      'Não iniciada',
      'Pendente',
    ])
  })

  it('completes a stage from the record it produces, not from the OS status', () => {
    const stages = buildServiceOrderWorkflowStages(
      stagesInput({
        evaluations: [evaluation()],
        quotes: [quote({ status: 'sent', version: 2 })],
      }),
    )

    expect(stages[0]).toMatchObject({ state: 'done', hint: 'Reparo' })
    // Sent but not approved: the quote stage is where the work still sits.
    expect(stages[1]).toMatchObject({ state: 'current', hint: 'v2 · Enviado' })
    expect(stages[2].state).toBe('pending')
  })

  it('walks the current marker forward as each stage closes', () => {
    const stages = buildServiceOrderWorkflowStages(
      stagesInput({
        evaluations: [evaluation()],
        quotes: [quote({ status: 'approved', version: 3 })],
        execution: runningExecution('2026-05-21T15:00:00.000Z'),
      }),
    )

    expect(stages.map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
    ])
    expect(stages[2].hint).toBe('Concluída')
    expect(stages[3].hint).toBe('Pendente')

    const delivered = buildServiceOrderWorkflowStages(
      stagesInput({
        evaluations: [evaluation()],
        quotes: [quote({ status: 'approved' })],
        execution: runningExecution('2026-05-21T15:00:00.000Z'),
        deliveredAt: '2026-05-22T12:00:00.000Z',
      }),
    )

    expect(delivered.every((stage) => stage.state === 'done')).toBe(true)
  })

  it('reports an execution in progress separately from a finished one', () => {
    const stages = buildServiceOrderWorkflowStages(
      stagesInput({
        evaluations: [evaluation()],
        quotes: [quote({ status: 'approved' })],
        execution: runningExecution(null),
      }),
    )

    expect(stages[2]).toMatchObject({ state: 'current', hint: 'Em andamento' })
  })
})

// Mirrors CalibraApiError's shape (message + status) without importing the
// transport class into a feature test.
function apiError(message: string, status: number) {
  const error = new Error(message)
  Reflect.set(error, 'status', status)
  return error
}

type AffordanceInput = Pick<
  ServiceOrderDetail,
  'evaluations' | 'quotes' | 'execution' | 'deliveredAt' | 'status'
>

function base(overrides: Partial<AffordanceInput> = {}): AffordanceInput {
  return {
    evaluations: [],
    quotes: [],
    execution: null,
    deliveredAt: null,
    status: 'opened',
    ...overrides,
  }
}

describe('service order stage affordances', () => {
  it('locks every later stage on a fresh order', () => {
    expect(buildServiceOrderStageAffordances(base())).toEqual({
      evaluation: 'editable',
      quote: 'locked',
      execution: 'locked',
      delivery: 'locked',
    })
  })

  it('unlocks the quote once an evaluation exists', () => {
    const affordances = buildServiceOrderStageAffordances(
      base({ evaluations: [evaluation()], status: 'under_evaluation' }),
    )

    expect(affordances.quote).toBe('editable')
    // Still editable: nothing has been shown to the customer yet.
    expect(affordances.evaluation).toBe('editable')
  })

  it('freezes the evaluation as soon as a quote leaves the lab, not before', () => {
    const draftOnly = buildServiceOrderStageAffordances(
      base({
        evaluations: [evaluation()],
        quotes: [quote({ status: 'draft' })],
        status: 'under_evaluation',
      }),
    )
    expect(draftOnly.evaluation).toBe('editable')

    const sent = buildServiceOrderStageAffordances(
      base({
        evaluations: [evaluation()],
        quotes: [quote({ status: 'sent' })],
        status: 'awaiting_quote_approval',
      }),
    )
    expect(sent.evaluation).toBe('record-revisable')
  })

  it('turns a decided quote into a revisable record', () => {
    for (const status of ['approved', 'rejected']) {
      const affordances = buildServiceOrderStageAffordances(
        base({
          evaluations: [evaluation()],
          quotes: [quote({ status })],
          status: status === 'approved' ? 'quote_approved' : 'quote_rejected',
        }),
      )
      expect(affordances.quote).toBe('record-revisable')
    }
  })

  it('opens execution only where the lifecycle allows starting it', () => {
    // under_evaluation cannot reach repair_in_progress in one step.
    expect(
      buildServiceOrderStageAffordances(
        base({ evaluations: [evaluation()], status: 'under_evaluation' }),
      ).execution,
    ).toBe('locked')

    // quote_approved -> repair_in_progress is a permitted edge.
    expect(
      buildServiceOrderStageAffordances(
        base({
          evaluations: [evaluation()],
          quotes: [quote({ status: 'approved' })],
          status: 'quote_approved',
        }),
      ).execution,
    ).toBe('editable')
  })

  it('turns a finished execution into a record but leaves a running one editable', () => {
    const running = buildServiceOrderStageAffordances(
      base({
        evaluations: [evaluation()],
        execution: runningExecution(null),
        status: 'repair_in_progress',
      }),
    )
    expect(running.execution).toBe('editable')

    const finished = buildServiceOrderStageAffordances(
      base({
        evaluations: [evaluation()],
        execution: runningExecution('2026-05-21T15:00:00.000Z'),
        status: 'awaiting_final_review',
      }),
    )
    expect(finished.execution).toBe('record')
  })

  it('opens delivery at ready_for_pickup and closes it once delivered', () => {
    expect(
      buildServiceOrderStageAffordances(base({ status: 'ready_for_pickup' }))
        .delivery,
    ).toBe('editable')

    expect(
      buildServiceOrderStageAffordances(
        base({ status: 'delivered', deliveredAt: '2026-05-22T12:00:00.000Z' }),
      ).delivery,
    ).toBe('record')
  })

  it('makes every stage a record on a closed or canceled order', () => {
    for (const status of ['closed', 'canceled'] as const) {
      expect(
        buildServiceOrderStageAffordances(
          base({
            status,
            evaluations: [evaluation()],
            quotes: [quote({ status: 'approved' })],
            execution: runningExecution(null),
          }),
        ),
      ).toEqual({
        evaluation: 'record',
        quote: 'record',
        execution: 'record',
        delivery: 'record',
      })
    }
  })
})

describe('service order action errors', () => {
  it('treats a 409 as a lifecycle conflict', () => {
    const error = apiError('Este orcamento ja foi respondido', 409)

    expect(isServiceOrderLifecycleError(error)).toBe(true)
    expect(serviceOrderActionErrorMessage(error, 'Erro ao emitir')).toBe(
      'Este orcamento ja foi respondido. Atualize a página para ver o estado atual da OS.',
    )
  })

  it('treats the transition 400 as a lifecycle conflict', () => {
    const error = apiError('Transicao de status invalida', 400)

    expect(isServiceOrderLifecycleError(error)).toBe(true)
    expect(
      serviceOrderActionErrorMessage(error, 'Não foi possível iniciar'),
    ).toMatch(/Atualize a página/)
  })

  it('does NOT treat a validation 400 as a lifecycle conflict', () => {
    // zValidator also answers 400; suggesting a refresh there would be wrong.
    const error = apiError('deliveredToName: obrigatório', 400)

    expect(isServiceOrderLifecycleError(error)).toBe(false)
    expect(serviceOrderActionErrorMessage(error, 'Erro ao entregar')).toBe(
      'deliveredToName: obrigatório',
    )
  })

  it('falls back to the caller message for a non-Error or blank message', () => {
    expect(isServiceOrderLifecycleError(null)).toBe(false)
    expect(isServiceOrderLifecycleError('boom')).toBe(false)
    expect(serviceOrderActionErrorMessage(null, 'Erro ao salvar')).toBe(
      'Erro ao salvar',
    )
    expect(
      serviceOrderActionErrorMessage(new Error('  '), 'Erro ao salvar'),
    ).toBe('Erro ao salvar')
  })

  it('passes a plain server message through untouched', () => {
    const error = apiError('Informe o diagnóstico técnico.', 422)

    expect(serviceOrderActionErrorMessage(error, 'Erro ao salvar')).toBe(
      'Informe o diagnóstico técnico.',
    )
  })
})

describe('quote line totals', () => {
  it('multiplies quantity by unit price in cents', () => {
    expect(
      quoteItemLineTotal({
        ...createEmptyQuoteItem('service'),
        quantity: '3',
        unitPrice: '150,50',
      }),
    ).toBe(45150)
  })

  it('accepts a comma decimal quantity', () => {
    expect(
      quoteItemLineTotal({
        ...createEmptyQuoteItem('part'),
        quantity: '2,5',
        unitPrice: '10,00',
      }),
    ).toBe(2500)
  })

  it('returns null for an incomplete row so the editor can stay quiet', () => {
    expect(
      quoteItemLineTotal({
        ...createEmptyQuoteItem('service'),
        quantity: '1',
        unitPrice: '',
      }),
    ).toBeNull()
    expect(
      quoteItemLineTotal({
        ...createEmptyQuoteItem('service'),
        quantity: 'abc',
        unitPrice: '10,00',
      }),
    ).toBeNull()
  })

  it('keeps the sum consistent with the per-line values', () => {
    const items = [
      {
        ...createEmptyQuoteItem('service'),
        quantity: '2',
        unitPrice: '100,00',
      },
      { ...createEmptyQuoteItem('part'), quantity: '1', unitPrice: '49,90' },
      { ...createEmptyQuoteItem('part'), quantity: '1', unitPrice: '' },
    ]

    expect(quoteItemsTotal(items)).toBe(24990)
    expect(items.map(quoteItemLineTotal)).toEqual([20000, 4990, null])
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
    publicId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
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
