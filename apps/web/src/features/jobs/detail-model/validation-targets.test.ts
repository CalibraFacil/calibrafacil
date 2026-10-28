import { describe, expect, it } from 'vitest'
import {
  expressionIdentifiers,
  findValidationFor,
  validationTargets,
} from './validation-targets'

const validation = (left: string, right: string, message = left) => ({
  leftExpression: left,
  rightExpression: right,
  message,
})

describe('validation targets by identifier (roadmap 2 F1)', () => {
  it('REQ-F1-3: an output key matches a whole identifier, not a substring', () => {
    expect(validationTargets(validation('U', 'MPE / 3'), 'U')).toBe(true)
    expect(validationTargets(validation('abs(E)', 'U'), 'U')).toBe(true)
    expect(validationTargets(validation('U_c', 'MPE'), 'U')).toBe(false)
    expect(validationTargets(validation('Uexp + 1', 'MPE'), 'U')).toBe(false)
    expect(validationTargets(validation('E', 'MPE_U'), 'U')).toBe(false)
  })

  it('REQ-F1-3: numbers with exponents and member access do not invent identifiers', () => {
    expect([...expressionIdentifiers('1e-3 * k + 0.5e2')]).toEqual(['k'])
    expect(validationTargets(validation('E', '2e3'), 'e')).toBe(false)
  })

  it('REQ-F1-3: the review picks the criterion that names the output, not the first containing its letters', () => {
    const validations = [
      validation('U_c', '0.5', 'incerteza combinada'),
      validation('U', 'MPE / 3', 'incerteza expandida'),
    ]
    expect(findValidationFor(validations, 'U')?.message).toBe(
      'incerteza expandida',
    )
    expect(findValidationFor(validations, 'k')).toBeUndefined()
  })
})
