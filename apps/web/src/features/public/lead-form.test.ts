import { describe, expect, it } from 'vitest'

import { emptyLeadForm, parseLeadForm } from './lead-form'

describe('parseLeadForm', () => {
  it('parses a valid form and defaults an empty segment to "outro"', () => {
    const result = parseLeadForm({
      ...emptyLeadForm,
      name: 'Maria Silva',
      email: 'maria@lab.com.br',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.segment).toBe('outro')
      expect(result.data.email).toBe('maria@lab.com.br')
    }
  })

  it('returns a field error for a missing name', () => {
    const result = parseLeadForm({ ...emptyLeadForm, email: 'a@b.com' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.fieldErrors.some((e) => e.field === 'name')).toBe(true)
    }
  })

  it('returns a field error for an invalid email', () => {
    const result = parseLeadForm({
      ...emptyLeadForm,
      name: 'Maria',
      email: 'nope',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.fieldErrors.some((e) => e.field === 'email')).toBe(true)
    }
  })

  it('keeps a chosen segment', () => {
    const result = parseLeadForm({
      ...emptyLeadForm,
      name: 'Maria',
      email: 'a@b.com',
      segment: 'oficina',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.segment).toBe('oficina')
    }
  })
})
