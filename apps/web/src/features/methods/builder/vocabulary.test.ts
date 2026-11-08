import { describe, expect, it } from 'vitest'
import {
  GUM_TYPE_B_DISTRIBUTIONS,
  METHOD_VALIDATION_OPERATORS,
  TABLE_STATISTICS,
  UNCERTAINTY_DISTRIBUTIONS,
} from '@calibra-facil/shared'

import { pickOption } from './vocabulary'

describe('pickOption', () => {
  it.each([
    ['distribution', UNCERTAINTY_DISTRIBUTIONS],
    ['GUM distribution', GUM_TYPE_B_DISTRIBUTIONS],
    ['operator', METHOD_VALIDATION_OPERATORS],
    ['statistic', TABLE_STATISTICS],
  ])('accepts every shared %s value', (_name, options) => {
    for (const option of options) {
      expect(pickOption(options, option, options[0])).toBe(option)
    }
  })

  it('falls back for an unknown value or null', () => {
    expect(pickOption(UNCERTAINTY_DISTRIBUTIONS, 'u_shaped', 'normal')).toBe(
      'normal',
    )
    expect(pickOption(TABLE_STATISTICS, null, 'mean')).toBe('mean')
  })
})
