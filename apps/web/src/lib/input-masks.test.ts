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

  it('switches phone mask by digit count', () => {
    expect(resolveMask(brazilPhoneMask.mask, '1133334444')).toHaveLength(15)
    expect(resolveMask(brazilPhoneMask.mask, '11999994444')).toHaveLength(15)
  })
})

function resolveMask(mask: MaskitoOptions['mask'], value: string) {
  return typeof mask === 'function' ? mask({ value, selection: [0, 0] }) : mask
}
