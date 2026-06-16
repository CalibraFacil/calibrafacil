import { describe, expect, it } from 'vitest'
import type { MaskitoOptions } from '@maskito/core'

import { brazilPhoneMask, cepMask, cnpjMask, cpfCnpjMask } from './input-masks'

describe('input masks', () => {
  it('defines a fixed CEP mask', () => {
    expect(Array.isArray(cepMask.mask)).toBe(true)
    expect(cepMask.mask).toHaveLength(9)
  })

  it('defines a fixed CNPJ mask', () => {
    expect(Array.isArray(cnpjMask.mask)).toBe(true)
    expect(cnpjMask.mask).toHaveLength(18)
  })

  it('switches CPF/CNPJ by digit count', () => {
    expect(resolveMask(cpfCnpjMask.mask, '12345678901')).toHaveLength(14)
    expect(resolveMask(cpfCnpjMask.mask, '12345678901234')).toHaveLength(18)
  })

  it('switches to CNPJ as soon as a letter is typed (alphanumeric CNPJ)', () => {
    expect(resolveMask(cpfCnpjMask.mask, '12ABC')).toHaveLength(18)
    expect(resolveMask(cpfCnpjMask.mask, '12.ABC.345/01DE-35')).toHaveLength(18)
  })

  it('accepts letters in CNPJ base positions but not the check digits', () => {
    const mask = resolveMask(cnpjMask.mask, '')
    if (!Array.isArray(mask)) throw new Error('expected array mask')
    // position 0 (base) accepts a letter; position 16 (first DV) does not
    expect(maskAccepts(mask[0], 'A')).toBe(true)
    expect(maskAccepts(mask[16], 'A')).toBe(false)
    expect(maskAccepts(mask[16], '5')).toBe(true)
  })

  it('uppercases CNPJ input via postprocessor', () => {
    const post = cnpjMask.postprocessors?.[0]
    if (!post) throw new Error('expected a postprocessor')
    const state: { value: string; selection: [number, number] } = {
      value: '12abc34501de35',
      selection: [0, 0],
    }
    expect(post(state, state).value).toBe('12ABC34501DE35')
  })

  it('switches phone mask by digit count', () => {
    expect(resolveMask(brazilPhoneMask.mask, '1133334444')).toHaveLength(15)
    expect(resolveMask(brazilPhoneMask.mask, '11999994444')).toHaveLength(15)
  })
})

function resolveMask(mask: MaskitoOptions['mask'], value: string) {
  return typeof mask === 'function' ? mask({ value, selection: [0, 0] }) : mask
}

function maskAccepts(token: string | RegExp, char: string) {
  return token instanceof RegExp && token.test(char)
}
