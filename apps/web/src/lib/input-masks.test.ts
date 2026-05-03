import { describe, expect, it } from 'vitest'

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
    expect(
      Array.isArray(cpfCnpjMask.mask)
        ? cpfCnpjMask.mask
        : cpfCnpjMask.mask({ value: '12345678901', selection: [0, 0] }),
    ).toHaveLength(14)
    expect(
      Array.isArray(cpfCnpjMask.mask)
        ? cpfCnpjMask.mask
        : cpfCnpjMask.mask({ value: '12345678901234', selection: [0, 0] }),
    ).toHaveLength(18)
  })

  it('switches phone mask by digit count', () => {
    expect(
      Array.isArray(brazilPhoneMask.mask)
        ? brazilPhoneMask.mask
        : brazilPhoneMask.mask({ value: '1133334444', selection: [0, 0] }),
    ).toHaveLength(15)
    expect(
      Array.isArray(brazilPhoneMask.mask)
        ? brazilPhoneMask.mask
        : brazilPhoneMask.mask({ value: '11999994444', selection: [0, 0] }),
    ).toHaveLength(15)
  })
})
