import { describe, expect, it } from 'vitest'

import {
  certificateTemplateMethodsQueryOptions,
  certificateTemplatesQueryOptions,
  certificateTemplateXlsxPreviewQueryOptions,
  certificateTemplateXlsxVersionQueryOptions,
} from './queries'

describe('certificate template feature queries', () => {
  it('uses stable list and linked-method keys', () => {
    expect(certificateTemplatesQueryOptions().queryKey).toEqual([
      'certificate-templates',
    ])
    expect(certificateTemplateMethodsQueryOptions().queryKey).toEqual([
      'certificate-template-linked-methods',
      'cloud',
    ])
  })

  it('keys XLSX version and preview reads by template/version ids', () => {
    expect(
      certificateTemplateXlsxVersionQueryOptions({
        templateId: 1,
        versionId: 2,
      }).queryKey,
    ).toEqual(['certificate-template-xlsx-version', 1, 2])
    expect(
      certificateTemplateXlsxPreviewQueryOptions({
        templateId: 1,
        versionId: 2,
        previewId: 3,
      }).queryKey,
    ).toEqual(['certificate-template-xlsx-preview', 1, 2, 3])
  })
})
