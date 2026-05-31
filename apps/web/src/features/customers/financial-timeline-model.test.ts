import { describe, expect, it } from 'vitest'
import {
  customerFinancialTimelineRow,
  customerTimelineFreshnessLabel,
} from './financial-timeline-model'

describe('customer financial timeline model', () => {
  it('builds provider-neutral timeline labels', () => {
    const row = customerFinancialTimelineRow({
      id: 10,
      documentNumber: 'FIN-10',
      status: 'ISSUED',
      exportStatus: 'EXPORTED',
      continuityStatus: 'AWAITING_PAYMENT',
      label: 'Aguardando confirmação de pagamento',
      issueDate: '2026-05-20T00:00:00.000Z',
      dueDate: '2026-06-20T00:00:00.000Z',
      totalCents: 120000,
      currency: 'BRL',
      unit: { id: 1, name: 'Matriz' },
      installments: [],
      receipts: [
        {
          id: 1,
          installmentId: 1,
          receivedAt: '2026-06-01T00:00:00.000Z',
          amountCents: 40000,
          paymentMethod: 'PIX',
          reference: null,
        },
      ],
      fiscalDocuments: [
        {
          availability: 'AVAILABLE',
          label: 'Documento fiscal disponível',
          number: 'NF-1',
          issuedAt: '2026-05-20T00:00:00.000Z',
          accessKey: null,
          xmlAvailable: false,
          consultationOnly: true,
          lastSyncedAt: '2026-05-20T00:00:00.000Z',
        },
      ],
      freshness: {
        status: 'fresh',
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
        label: 'Sincronizado',
      },
      providerEvidence: null,
    })

    expect(row).toMatchObject({
      title: 'Documento FIN-10',
      statusLabel: 'Aguardando confirmação de pagamento',
      fiscalLabel: 'Documento fiscal disponível',
      evidenceLabel: 'Sincronizado',
      evidenceReconnectPath: null,
      evidenceReconnectLabel: null,
    })
  })

  it('keeps reconnect link text provider-neutral', () => {
    const row = customerFinancialTimelineRow({
      id: 10,
      documentNumber: 'FIN-10',
      status: 'ISSUED',
      exportStatus: 'EXPORTED',
      continuityStatus: 'STATUS_UNAVAILABLE',
      label: 'Status indisponível',
      issueDate: '2026-05-20T00:00:00.000Z',
      dueDate: '2026-06-20T00:00:00.000Z',
      totalCents: 120000,
      currency: 'BRL',
      unit: { id: 1, name: 'Matriz' },
      installments: [],
      receipts: [],
      fiscalDocuments: [],
      freshness: {
        status: 'stale',
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
        label: 'Status desatualizado',
      },
      providerEvidence: {
        label: 'Reconecte Conta Azul para atualizar o status',
        integrationState: 'disconnected',
        reconnectPath: '/dashboard/settings/integrations#financial-erp',
      },
    })

    expect(row).toMatchObject({
      evidenceLabel: 'Reconecte Conta Azul para atualizar o status',
      evidenceReconnectPath: '/dashboard/settings/integrations#financial-erp',
      evidenceReconnectLabel: 'Reconectar',
    })
  })

  it('does not invent a missing fiscal-document label', () => {
    const row = customerFinancialTimelineRow({
      id: 10,
      documentNumber: 'FIN-10',
      status: 'ISSUED',
      exportStatus: 'EXPORTED',
      continuityStatus: 'AWAITING_PAYMENT',
      label: 'Aguardando confirmação de pagamento',
      issueDate: '2026-05-20T00:00:00.000Z',
      dueDate: '2026-06-20T00:00:00.000Z',
      totalCents: 120000,
      currency: 'BRL',
      unit: { id: 1, name: 'Matriz' },
      installments: [],
      receipts: [],
      fiscalDocuments: [],
      freshness: {
        status: 'fresh',
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
        label: 'Sincronizado',
      },
      providerEvidence: null,
    })

    expect(row.fiscalLabel).toBeNull()
    expect(row.evidenceLabel).toBe('Sincronizado')
  })

  it('formats timeline header freshness without provider jargon', () => {
    expect(
      customerTimelineFreshnessLabel({
        status: 'fresh',
        lastSyncedAt: '2026-05-20T00:00:00.000Z',
        label: 'Sincronizado',
      }),
    ).toMatch(/^Sincronizado em 20\/05\/2026/)
    expect(customerTimelineFreshnessLabel(null)).toBe('Status local')
  })
})
