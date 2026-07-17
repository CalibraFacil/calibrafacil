import { afterEach, describe, expect, it, vi } from 'vitest'

import { isWysiwygEditorEnabled } from './wysiwyg-flag'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isWysiwygEditorEnabled', () => {
  it('is OFF by default (labs must not see a mid-reframe editor)', () => {
    vi.stubEnv('VITE_WYSIWYG_EDITOR_ENABLED', '')
    expect(isWysiwygEditorEnabled()).toBe(false)
  })

  it('turns on only with the exact literal "true"', () => {
    vi.stubEnv('VITE_WYSIWYG_EDITOR_ENABLED', 'true')
    expect(isWysiwygEditorEnabled()).toBe(true)
    vi.stubEnv('VITE_WYSIWYG_EDITOR_ENABLED', '1')
    expect(isWysiwygEditorEnabled()).toBe(false)
  })
})
