import { format } from 'date-fns'
import { describe, expect, it } from 'vitest'

import {
  buildScopeLinePayload,
  canSaveScopeLine,
  emptyScopeLineForm,
  formatVigencia,
  scopeLineToFormState,
  type ScopeLineFormState,
} from './accredited-scope-forms'

function form(overrides: Partial<ScopeLineFormState>): ScopeLineFormState {
  return {
    ...emptyScopeLineForm,
    rangeMin: '0',
    rangeMax: '500',
    cmcA: '0,01',
    ...overrides,
  }
}

describe('buildScopeLinePayload', () => {
  it('parses pt-BR comma decimals into numbers', () => {
    const built = buildScopeLinePayload(form({}), null)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.payload).toMatchObject({
      quantityKind: 'mass',
      rangeMin: 0,
      rangeMax: 500,
      cmcA: 0.01,
      cmcType: 'fixed',
    })
    expect(built.payload.id).toBeUndefined()
  })

  it('anchors validUntil at end-of-day so the stated last day stays valid (#647 semantics)', () => {
    const built = buildScopeLinePayload(
      form({
        validFrom: new Date(2026, 0, 15), // local 15/01/2026
        validUntil: new Date(2026, 11, 31), // local 31/12/2026
      }),
      7,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.payload.id).toBe(7)
    // Anchored on the laboratory's calendar days (America/Sao_Paulo, -03:00),
    // like the org-level window: intentional change from the UTC anchor.
    expect(built.payload.validFrom).toBe('2026-01-15T03:00:00.000Z')
    expect(built.payload.validUntil).toBe('2027-01-01T02:59:59.999Z')
  })

  it('rejects non-numeric input instead of sending NaN to the API', () => {
    const built = buildScopeLinePayload(form({ cmcA: 'abc' }), null)
    expect(built).toMatchObject({ ok: false })
  })

  it('rejects an inverted range through the shared schema', () => {
    const built = buildScopeLinePayload(
      form({ rangeMin: '500', rangeMax: '0' }),
      null,
    )
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toContain('Faixa inválida')
  })

  it('requires cmcB for a linear CMC', () => {
    expect(
      buildScopeLinePayload(form({ cmcType: 'linear', cmcB: '' }), null).ok,
    ).toBe(false)
    const built = buildScopeLinePayload(
      form({ cmcType: 'linear', cmcA: '0', cmcB: '0,0002' }),
      null,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.payload.cmcB).toBe(0.0002)
  })
})

describe('canSaveScopeLine', () => {
  it('requires numeric range and CMC values', () => {
    expect(canSaveScopeLine(form({}))).toBe(true)
    expect(canSaveScopeLine(form({ rangeMax: '' }))).toBe(false)
    expect(canSaveScopeLine(form({ cmcA: 'x' }))).toBe(false)
    expect(canSaveScopeLine(form({ cmcType: 'linear', cmcB: '' }))).toBe(false)
  })
})

describe('scopeLineToFormState', () => {
  it('round-trips a stored line into editable strings', () => {
    const state = scopeLineToFormState({
      id: 3,
      unitId: 1,
      quantityKind: 'mass',
      rangeMin: 0,
      rangeMax: 500,
      rangeUnit: 'g',
      cmcType: 'linear',
      cmcA: 0.005,
      cmcB: 0.0001,
      cmcUnit: 'g',
      coverageFactor: 2,
      description: 'Balanças classe II',
      validFrom: '2026-01-15T00:00:00.000Z',
      validUntil: '2026-12-31T23:59:59.999Z',
    })
    expect(state).toMatchObject({
      quantityKind: 'mass',
      rangeMin: '0',
      rangeMax: '500',
      cmcType: 'linear',
      cmcA: '0.005',
      cmcB: '0.0001',
      description: 'Balanças classe II',
    })
    expect(state.validFrom).toBeInstanceOf(Date)
    expect(state.validUntil).toBeInstanceOf(Date)
  })

  it('reads stored bounds back as the calendar days they name', () => {
    const base = {
      id: 3,
      unitId: 1,
      quantityKind: 'mass' as const,
      rangeMin: 0,
      rangeMax: 500,
      rangeUnit: 'g',
      cmcType: 'fixed' as const,
      cmcA: 0.005,
      cmcB: null,
      cmcUnit: 'g',
      coverageFactor: 2,
      description: null,
    }
    for (const [validFrom, validUntil] of [
      ['2026-01-15T03:00:00.000Z', '2027-01-01T02:59:59.999Z'],
      // Legacy UTC anchor: the start used to read as the evening before.
      ['2026-01-15T00:00:00.000Z', '2026-12-31T23:59:59.999Z'],
    ]) {
      const state = scopeLineToFormState({ ...base, validFrom, validUntil })
      expect(state.validFrom && format(state.validFrom, 'yyyy-MM-dd')).toBe(
        '2026-01-15',
      )
      expect(state.validUntil && format(state.validUntil, 'yyyy-MM-dd')).toBe(
        '2026-12-31',
      )
      expect(formatVigencia({ ...base, validFrom, validUntil })).toBe(
        '15/01/2026 a 31/12/2026',
      )
    }
  })
})
