import { describe, expect, it } from 'vitest'
import type { LocalBlockedOutboxEvent } from '@calibra-facil/contracts'

import {
  conflictStatusLabel,
  getConflictDiscardPrompt,
  validateDiscardReason,
} from '@/runtime/sync-conflict-discard'
import {
  describeBlockedEvent,
  getBlockedEventsBannerLabel,
} from '@/runtime/sync-dead-events'

describe('REQ-E1-3: discarding a sync conflict, in pt-BR', () => {
  it('names every conflict status in pt-BR, and the old "ignored" as a previous-version decision', () => {
    expect(conflictStatusLabel('open')).toBe('Aberto')
    expect(conflictStatusLabel('discarded_by_user')).toBe(
      'Descartado pelo usuário',
    )
    expect(conflictStatusLabel('ignored')).toContain('versão anterior')
    expect(conflictStatusLabel('resolved')).toBeTruthy()
  })

  it('requires a reason for calibration readings and not for other changes', () => {
    const regulated = getConflictDiscardPrompt({ regulated: true })
    expect(regulated.reasonRequired).toBe(true)
    expect(regulated.description).toContain('somente neste computador')
    expect(regulated.description).toContain('nunca será reenviada')

    const other = getConflictDiscardPrompt({ regulated: false })
    expect(other.reasonRequired).toBe(false)
    expect(other.description).toContain('não será reenviada')
  })

  it('validates the reason', () => {
    expect(validateDiscardReason('', true)).toMatch(/motivo/i)
    expect(validateDiscardReason('   ok  ', true)).toMatch(/motivo/i)
    expect(validateDiscardReason('Padrão trocado', true)).toBeNull()
    expect(validateDiscardReason('', false)).toBeNull()
    expect(validateDiscardReason('x'.repeat(2001), false)).toMatch(/2000/)
  })
})

describe('REQ-E1-2: blocked events, in pt-BR', () => {
  const blocked: LocalBlockedOutboxEvent = {
    eventId: 'event:update-1',
    entityType: 'asset',
    entityId: 'asset:local-1',
    operation: 'update_local_asset',
    occurredAt: '2026-05-10T12:00:00.000Z',
    blockedByEventId: 'event:create-1',
    blockedByOperation: 'create_local_asset',
    blockedByEntityType: 'asset',
    blockedByErrorCode: 'TAG_ALREADY_EXISTS',
    blockedByStatus: 'dead',
    regulated: false,
  }

  it('says what it waits for and why, without the code', () => {
    const description = describeBlockedEvent(blocked)

    expect(description.title).toBe('Ativo · Edição de instrumento')
    expect(description.reason).toContain('Cadastro de instrumento')
    expect(description.reason).toContain('foi recusada pela nuvem')
    expect(description.reason).not.toContain('TAG_ALREADY_EXISTS')
  })

  it('explains a dependent of a discarded creation', () => {
    expect(
      describeBlockedEvent({ ...blocked, blockedByStatus: 'discarded' }).reason,
    ).toContain('nunca chegou à nuvem')
  })

  it('labels the banner by count', () => {
    expect(getBlockedEventsBannerLabel(0)).toBeNull()
    expect(getBlockedEventsBannerLabel(undefined)).toBeNull()
    expect(getBlockedEventsBannerLabel(1)).toBe(
      '1 alteração aguarda outra que precisa de decisão.',
    )
    expect(getBlockedEventsBannerLabel(3)).toContain('3 alterações aguardam')
  })
})
