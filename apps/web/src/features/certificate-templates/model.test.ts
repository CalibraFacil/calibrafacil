import { describe, expect, it } from 'vitest'

import type {
  TemplateItem,
  XlsxBindingManifest,
  XlsxWorkbenchState,
} from '@/features/certificate-templates/types'
import {
  buildXlsxAssignmentPayload,
  buildXlsxBindingManifestForSave,
  certificateTemplateKey,
  createEmptyCertificateTemplateDraft,
  createCertificateTemplateDraft,
  formatCertificateTemplateApiError,
  formatCertificateTemplateDateTime,
  getActiveCertificateTemplateXlsxPreviewId,
  getActiveCertificateTemplateXlsxWorkbench,
  getDefaultCertificateTemplateKey,
  getSelectedCertificateTemplate,
  getXlsxStatusLabel,
  parseCertificateTemplatePriority,
  parseOptionalPositiveInt,
  updateXlsxScalarBinding,
} from './model'

function createTemplateItem(
  overrides: Partial<TemplateItem> = {},
): TemplateItem {
  return {
    id: 12,
    name: 'Balança padrão',
    slug: 'default-scale',
    version: 1,
    status: 'ACTIVE',
    isDefault: false,
    createdAt: null,
    updatedAt: null,
    currentXlsxVersion: null,
    ...overrides,
  }
}

function createManifest(): XlsxBindingManifest {
  return {
    schemaVersion: 'calibrafacil.certificateXlsxBinding.v1',
    requiredFields: [],
    governedFields: [],
    scalarBindings: [
      {
        id: 'binding-1',
        sheet: 'Certificado',
        cell: 'A1',
        fieldPath: 'certificate.number',
        required: true,
        governed: true,
      },
      {
        id: 'binding-2',
        sheet: 'Certificado',
        cell: 'A2',
        fieldPath: 'customer.name',
        governed: false,
      },
    ],
    imageBindings: [],
    tableBindings: [],
    renderPolicy: {
      formulas: 'preserve',
      macros: 'reject',
      externalLinks: 'reject',
      converter: 'gotenberg-libreoffice',
    },
  }
}

function createWorkbench(
  overrides: Partial<XlsxWorkbenchState> = {},
): XlsxWorkbenchState {
  return {
    version: {
      id: 10,
      templateId: 12,
      version: 2,
      status: 'DRAFT',
      xlsxSha256: 'sha',
      bindingManifestSha256: 'manifest-sha',
    },
    analysis: {
      sheets: [],
      warnings: [],
    },
    manifest: createManifest(),
    ...overrides,
  }
}

describe('certificate template model', () => {
  it('builds stable route keys for custom and system templates', () => {
    expect(certificateTemplateKey(createTemplateItem({ id: 42 }))).toBe('42')
    expect(certificateTemplateKey(createTemplateItem({ id: null }))).toBe(
      'system:default-scale',
    )
  })

  it('creates editable drafts from template records', () => {
    expect(createCertificateTemplateDraft(createTemplateItem())).toEqual({
      name: 'Balança padrão',
    })
    expect(createEmptyCertificateTemplateDraft()).toEqual({ name: '' })
  })

  it('selects the default and active certificate templates', () => {
    const first = createTemplateItem({ id: 1, name: 'Primeiro' })
    const fallback = createTemplateItem({
      id: 2,
      name: 'Padrão',
      isDefault: true,
    })

    expect(getDefaultCertificateTemplateKey([first, fallback])).toBe('2')
    expect(
      getSelectedCertificateTemplate({
        templates: [first, fallback],
        selectedTemplateKey: '2',
      }),
    ).toBe(fallback)
    expect(
      getSelectedCertificateTemplate({
        templates: [first, fallback],
        selectedTemplateKey: 'missing',
      }),
    ).toBe(first)
  })

  it('resolves the active XLSX workbench and preview id for the selected template', () => {
    const selectedTemplate = createTemplateItem({ id: 12 })
    const currentWorkbench = createWorkbench({
      version: { ...createWorkbench().version, id: 9, templateId: 12 },
    })
    const uploadedWorkbench = createWorkbench({
      version: { ...createWorkbench().version, id: 10, templateId: 12 },
    })

    expect(
      getActiveCertificateTemplateXlsxWorkbench({
        currentXlsxWorkbench: currentWorkbench,
        selectedTemplate,
        xlsxWorkbench: uploadedWorkbench,
      }),
    ).toBe(uploadedWorkbench)
    expect(
      getActiveCertificateTemplateXlsxPreviewId({
        activeXlsxWorkbench: uploadedWorkbench,
        selectedTemplate,
        xlsxPreview: { id: 30, templateId: 12, versionId: 10 },
      }),
    ).toBe(30)
    expect(
      getActiveCertificateTemplateXlsxPreviewId({
        activeXlsxWorkbench: uploadedWorkbench,
        selectedTemplate,
        xlsxPreview: { id: 31, templateId: 12, versionId: 9 },
      }),
    ).toBeNull()
  })

  it('parses assignment numeric fields conservatively', () => {
    expect(parseOptionalPositiveInt('')).toBeUndefined()
    expect(parseOptionalPositiveInt('0')).toBeUndefined()
    expect(parseOptionalPositiveInt('-1')).toBeUndefined()
    expect(parseOptionalPositiveInt('15')).toBe(15)
    expect(parseCertificateTemplatePriority('')).toBe(0)
    expect(parseCertificateTemplatePriority('abc')).toBe(0)
    expect(parseCertificateTemplatePriority('3')).toBe(3)
    expect(
      buildXlsxAssignmentPayload({
        unitId: '1',
        serviceId: '',
        methodId: '7',
        priority: '50',
      }),
    ).toEqual({
      certificateType: 'calibration',
      priority: 50,
      unitId: 1,
      serviceId: undefined,
      methodId: 7,
    })
  })

  it('builds XLSX binding manifests and updates scalar bindings immutably', () => {
    const workbench = createWorkbench()
    const manifest = buildXlsxBindingManifestForSave(workbench.manifest)
    const updated = updateXlsxScalarBinding(workbench, 'binding-2', {
      required: true,
      formatter: 'upper_case',
    })

    expect(manifest.requiredFields).toEqual(['certificate.number'])
    expect(manifest.governedFields).toEqual(['certificate.number'])
    expect(updated).not.toBe(workbench)
    expect(updated.manifest.scalarBindings[1]).toMatchObject({
      required: true,
      formatter: 'upper_case',
    })
    expect(workbench.manifest.scalarBindings[1]?.required).toBeUndefined()
  })

  it('formats API errors with the top warning messages', () => {
    expect(formatCertificateTemplateApiError(null, 'Falha')).toBe('Falha')
    expect(
      formatCertificateTemplateApiError(
        {
          error: 'Planilha inválida',
          warnings: [
            { message: 'Aba ausente' },
            { message: 'Campo obrigatório' },
            { message: 'Token desconhecido' },
            { message: 'Ignorado por limite' },
          ],
        },
        'Falha',
      ),
    ).toBe(
      [
        'Planilha inválida',
        'Aba ausente',
        'Campo obrigatório',
        'Token desconhecido',
      ].join('\n'),
    )
  })

  it('formats date and XLSX status labels', () => {
    expect(formatCertificateTemplateDateTime(null)).toBe('Nunca')
    expect(getXlsxStatusLabel('PUBLISHED')).toBe('Publicado')
    expect(getXlsxStatusLabel('VALIDATED')).toBe('Validado')
    expect(getXlsxStatusLabel('DRAFT')).toBe('Rascunho')
    expect(getXlsxStatusLabel(null)).toBe('Sem XLSX')
    expect(getXlsxStatusLabel('PROCESSING')).toBe('PROCESSING')
  })
})
