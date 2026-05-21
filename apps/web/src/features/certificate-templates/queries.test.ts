import { describe, expect, it } from 'vitest'

import {
  certificateTemplateMethodsQueryOptions,
  certificateTemplateServicesQueryOptions,
  certificateTemplatesQueryOptions,
  certificateTemplateUnitsQueryOptions,
  certificateTemplateXlsxPreviewQueryOptions,
  certificateTemplateXlsxVersionQueryOptions,
} from './queries'

describe('certificate template feature queries', () => {
  it('uses stable list and assignment option keys', () => {
    expect(certificateTemplatesQueryOptions().queryKey).toEqual([
      'certificate-templates',
    ])
    expect(certificateTemplateMethodsQueryOptions().queryKey).toEqual([
      'certificate-template-assignment-options',
      'methods',
      'cloud',
    ])
    expect(certificateTemplateServicesQueryOptions().queryKey).toEqual([
      'certificate-template-assignment-options',
      'services',
      'cloud',
    ])
    expect(certificateTemplateUnitsQueryOptions().queryKey).toEqual([
      'certificate-template-assignment-options',
      'units',
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
