import { describe, expect, it } from 'vitest'

import {
  getDispositionLabel,
  getOotStatusBadge,
  getStatusBadge,
  getTypeLabel,
  ncAvailableActions,
} from './nc-model'

describe('ncAvailableActions', () => {
  it('requires a disposition before resolution (ISO/IEC 17025 §7.10 ordering)', () => {
    const actions = ncAvailableActions({
      status: 'open',
      disposition: null,
      capaId: null,
    })
    expect(actions).toContain('setDisposition')
    expect(actions).not.toContain('resolve')
  })

  it('offers resolution once the disposition is set', () => {
    const actions = ncAvailableActions({
      status: 'open',
      disposition: 'rework',
      capaId: null,
    })
    expect(actions).toContain('resolve')
    expect(actions).not.toContain('setDisposition')
  })

  it('allows CAPA escalation only while no CAPA is linked', () => {
    expect(
      ncAvailableActions({ status: 'open', disposition: null, capaId: null }),
    ).toContain('escalateToCapa')
    expect(
      ncAvailableActions({ status: 'open', disposition: null, capaId: 42 }),
    ).not.toContain('escalateToCapa')
  })

  it('offers no actions after resolution', () => {
    expect(
      ncAvailableActions({
        status: 'resolved',
        disposition: 'rework',
        capaId: null,
      }),
    ).toEqual([])
  })

  it('keeps the lifecycle available while under review', () => {
    const actions = ncAvailableActions({
      status: 'under_review',
      disposition: 'scrap',
      capaId: 7,
    })
    expect(actions).toEqual(['resolve'])
  })
})

describe('presentation maps', () => {
  it('maps NC statuses to badges', () => {
    expect(getStatusBadge('open')).toEqual({
      variant: 'destructive',
      label: 'Aberta',
    })
    expect(getStatusBadge('resolved').label).toBe('Resolvida')
    expect(getStatusBadge('anything-else').label).toBe('anything-else')
  })

  it('maps dispositions with a pending fallback', () => {
    expect(getDispositionLabel(null)).toBe('Pendente')
    expect(getDispositionLabel('use_as_is')).toBe('Uso como esta')
  })

  it('maps NC types and OOT notification statuses', () => {
    expect(getTypeLabel('out_of_tolerance')).toBe('Fora de tolerância')
    expect(getOotStatusBadge('ACKNOWLEDGED').label).toBe('Confirmada')
    expect(getOotStatusBadge('PENDING').label).toBe('Gerada')
  })
})
