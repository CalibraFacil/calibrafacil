import { describe, expect, it } from 'vitest'

import {
  PASSKEY_NAME_MAX_LENGTH,
  defaultPasskeyName,
  parsePasskeyNameForm,
} from './forms'

describe('parsePasskeyNameForm', () => {
  it('accepts and trims a valid name', () => {
    const result = parsePasskeyNameForm({ name: '  MacBook do laboratório  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('MacBook do laboratório')
    }
  })

  it('rejects an empty / whitespace-only name with a field error', () => {
    const result = parsePasskeyNameForm({ name: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.fieldErrors).toEqual([
        { field: 'name', message: expect.any(String) },
      ])
    }
  })

  it('rejects a name longer than the max length', () => {
    const result = parsePasskeyNameForm({
      name: 'a'.repeat(PASSKEY_NAME_MAX_LENGTH + 1),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.fieldErrors[0]?.field).toBe('name')
    }
  })
})

describe('defaultPasskeyName', () => {
  it('produces a dated, human-readable default label', () => {
    const name = defaultPasskeyName(new Date('2026-06-25T12:00:00.000Z'))
    expect(name).toMatch(/^Passkey • \d{2}\/\d{2}\/\d{4}$/)
  })
})
