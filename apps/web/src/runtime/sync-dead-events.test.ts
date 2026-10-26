import {
  LOCAL_OUTBOX_FAILURE_CLASSES,
  OUTBOX_REJECTION_CLASSES,
  type LocalDeadOutboxEvent,
} from '@calibra-facil/contracts'
import { describe, expect, it } from 'vitest'

import {
  describeDeadEvent,
  getDeadEventDiscardWarning,
  getDeadEventsBannerLabel,
} from './sync-dead-events'

function deadEvent(
  overrides: Partial<LocalDeadOutboxEvent> = {},
): LocalDeadOutboxEvent {
  return {
    eventId: 'event:1',
    entityType: 'customer',
    entityId: 'customer:1',
    operation: 'create_local_customer',
    errorCode: 'UNSUPPORTED_SYNC_OPERATION',
    errorMessage: 'Sync operation is not supported by this server.',
    attemptCount: 1,
    occurredAt: '2026-05-10T12:00:00.000Z',
    deadAt: '2026-05-10T12:01:00.000Z',
    regulated: false,
    ...overrides,
  }
}

describe('describeDeadEvent', () => {
  it('REQ-OB-3: gives the reason in pt-BR, not the cloud code', () => {
    const description = describeDeadEvent(
      deadEvent({
        errorCode: 'STANDARD_EXPIRED',
        errorMessage: 'Desktop execution references expired standards: P1.',
      }),
    )

    expect(description.reason).toBe(
      'Um padrão usado nesta calibração está com o certificado vencido.',
    )
    expect(description.reason).not.toContain('STANDARD_EXPIRED')
    expect(description.detail).toBe(
      'Desktop execution references expired standards: P1.',
    )
  })

  it('REQ-OB-3: names the entity and the operation in pt-BR', () => {
    expect(
      describeDeadEvent(
        deadEvent({
          entityType: 'calibration_job',
          operation: 'submit_local_execution',
        }),
      ).title,
    ).toBe('Calibração · Envio da execução para aprovação')
  })

  it('REQ-OB-3: covers every permanent rejection code with its own reason', () => {
    const permanent = Object.entries({
      ...OUTBOX_REJECTION_CLASSES,
      ...LOCAL_OUTBOX_FAILURE_CLASSES,
    })
      .filter(([, rejectionClass]) => rejectionClass === 'permanent')
      .map(([code]) => code)
    const generic = describeDeadEvent(
      deadEvent({ errorCode: 'NOT_A_REAL_CODE' }),
    ).reason

    expect(permanent.length).toBeGreaterThan(10)
    for (const code of permanent) {
      const reason = describeDeadEvent(deadEvent({ errorCode: code })).reason
      expect(reason, code).not.toBe(generic)
      expect(reason, code).not.toContain(code)
    }
  })

  it('REQ-OB-3: falls back to a generic pt-BR reason for a code it does not know', () => {
    expect(
      describeDeadEvent(deadEvent({ errorCode: 'FROM_A_NEWER_CLOUD' })).reason,
    ).toBe('A nuvem recusou esta alteração e ela não será reenviada sozinha.')
    expect(describeDeadEvent(deadEvent({ errorCode: null })).reason).toBe(
      'A nuvem recusou esta alteração e ela não será reenviada sozinha.',
    )
  })
})

describe('getDeadEventDiscardWarning', () => {
  it('REQ-OB-3: warns that discarded execution readings stay only on this computer', () => {
    const warning = getDeadEventDiscardWarning(
      deadEvent({
        entityType: 'calibration_job',
        operation: 'submit_local_execution',
        regulated: true,
      }),
    )

    expect(warning.regulated).toBe(true)
    expect(warning.description).toContain(
      'As leituras ficam salvas somente neste computador',
    )
    expect(warning.description).toContain('não serão enviadas à nuvem')
    expect(warning.confirmLabel).toBe('Descartar mesmo assim')
  })

  it('REQ-OB-3: a plain event gets a lighter confirmation, without the readings warning', () => {
    const warning = getDeadEventDiscardWarning(deadEvent())

    expect(warning.regulated).toBe(false)
    expect(warning.description).not.toContain('leituras')
    expect(warning.description).toContain('registro local')
    expect(warning.confirmLabel).toBe('Descartar')
  })
})

describe('getDeadEventsBannerLabel', () => {
  it('REQ-OB-3: says nothing when no event was refused', () => {
    expect(getDeadEventsBannerLabel(0)).toBeNull()
    expect(getDeadEventsBannerLabel(undefined)).toBeNull()
  })

  it('REQ-OB-3: counts refused events with the right plural', () => {
    expect(getDeadEventsBannerLabel(1)).toBe(
      '1 alteração foi recusada pela nuvem e não será reenviada.',
    )
    expect(getDeadEventsBannerLabel(3)).toBe(
      '3 alterações foram recusadas pela nuvem e não serão reenviadas.',
    )
  })
})
