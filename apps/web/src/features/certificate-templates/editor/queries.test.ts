import { describe, expect, it } from 'vitest'

import type { TemplateItem } from '../types'
import { resolveEditorWysiwygVersionId } from './queries'

function template(overrides: Partial<TemplateItem>): TemplateItem {
  return {
    id: 5,
    name: 'Modelo Visual',
    slug: 'modelo-visual',
    version: 1,
    status: 'ACTIVE',
    isDefault: false,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('resolveEditorWysiwygVersionId', () => {
  it('prefers the DRAFT over a newer published version', () => {
    expect(
      resolveEditorWysiwygVersionId(
        template({
          wysiwygVersions: [
            { id: 12, version: 3, status: 'PUBLISHED' },
            { id: 9, version: 2, status: 'DRAFT' },
          ],
        }),
      ),
    ).toBe(9)
  })

  it('falls back to the latest wysiwyg version when no draft exists', () => {
    expect(
      resolveEditorWysiwygVersionId(
        template({
          wysiwygVersions: [{ id: 12, version: 3, status: 'PUBLISHED' }],
        }),
      ),
    ).toBe(12)
  })

  it('falls back to currentXlsxVersion for pre-deploy API responses', () => {
    expect(
      resolveEditorWysiwygVersionId(
        template({
          currentXlsxVersion: {
            id: 7,
            templateId: 5,
            version: 1,
            status: 'DRAFT',
            engine: 'wysiwyg',
            xlsxSha256: null,
            bindingManifestSha256: null,
          },
        }),
      ),
    ).toBe(7)
  })

  it('returns null for xlsx-only templates and null template', () => {
    expect(
      resolveEditorWysiwygVersionId(
        template({
          currentXlsxVersion: {
            id: 7,
            templateId: 5,
            version: 1,
            status: 'PUBLISHED',
            engine: 'xlsx',
            xlsxSha256: 'x',
            bindingManifestSha256: 'y',
          },
        }),
      ),
    ).toBeNull()
    expect(resolveEditorWysiwygVersionId(null)).toBeNull()
  })
})
