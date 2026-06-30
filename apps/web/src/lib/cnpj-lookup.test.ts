import { describe, expect, it } from 'vitest'

import { keepOrFill } from './cnpj-lookup'

describe('keepOrFill', () => {
  it('keeps a non-empty user value over the looked-up one', () => {
    expect(keepOrFill('Empresa do usuário', 'RAZAO SOCIAL RFB')).toBe(
      'Empresa do usuário',
    )
  })

  it('fills a blank field from the lookup', () => {
    expect(keepOrFill('', 'RAZAO SOCIAL RFB')).toBe('RAZAO SOCIAL RFB')
    expect(keepOrFill('   ', 'MODELO')).toBe('MODELO')
  })

  it('falls back to empty string when the lookup has no value', () => {
    expect(keepOrFill('', null)).toBe('')
  })
})
