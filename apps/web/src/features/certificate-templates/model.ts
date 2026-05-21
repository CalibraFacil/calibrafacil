import type {
  TemplateItem,
  XlsxBindingManifest,
  XlsxPreviewReference,
  XlsxScalarBinding,
  XlsxWorkbenchState,
} from '@/features/certificate-templates/types'

export type TemplateDraft = {
  name: string
}

export type XlsxAssignmentDraft = {
  unitId: string
  serviceId: string
  methodId: string
  priority: string
}

export function formatCertificateTemplateApiError(
  data: unknown,
  fallback: string,
) {
  if (!data || typeof data !== 'object') {
    return fallback
  }

  const record = Object.fromEntries(Object.entries(data))
  const message = 'error' in record ? String(record.error) : fallback
  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .map((warning) =>
          warning && typeof warning === 'object' && 'message' in warning
            ? String(Object.fromEntries(Object.entries(warning)).message)
            : null,
        )
        .filter(Boolean)
    : []

  return [message, ...warnings.slice(0, 3)].join('\n')
}

export function certificateTemplateKey(template: TemplateItem) {
  return template.id ? String(template.id) : `system:${template.slug}`
}

export function createCertificateTemplateDraft(
  template: TemplateItem,
): TemplateDraft {
  return {
    name: template.name,
  }
}

export function createEmptyCertificateTemplateDraft(): TemplateDraft {
  return { name: '' }
}

export function getDefaultCertificateTemplateKey(
  templates: readonly TemplateItem[],
) {
  const fallbackTemplate =
    templates.find((template) => template.isDefault) ?? templates[0] ?? null

  return fallbackTemplate ? certificateTemplateKey(fallbackTemplate) : null
}

export function getSelectedCertificateTemplate({
  templates,
  selectedTemplateKey,
}: {
  templates: readonly TemplateItem[]
  selectedTemplateKey: string | null
}) {
  return (
    templates.find(
      (template) => certificateTemplateKey(template) === selectedTemplateKey,
    ) ??
    templates[0] ??
    null
  )
}

export function getActiveCertificateTemplateXlsxWorkbench({
  currentXlsxWorkbench,
  selectedTemplate,
  xlsxWorkbench,
}: {
  currentXlsxWorkbench: XlsxWorkbenchState | null | undefined
  selectedTemplate: TemplateItem | null
  xlsxWorkbench: XlsxWorkbenchState | null
}) {
  if (
    xlsxWorkbench &&
    selectedTemplate?.id &&
    xlsxWorkbench.version.templateId === selectedTemplate.id
  ) {
    return xlsxWorkbench
  }

  return currentXlsxWorkbench ?? null
}

export function getActiveCertificateTemplateXlsxPreviewId({
  activeXlsxWorkbench,
  selectedTemplate,
  xlsxPreview,
}: {
  activeXlsxWorkbench: XlsxWorkbenchState | null
  selectedTemplate: TemplateItem | null
  xlsxPreview: XlsxPreviewReference | null
}) {
  return selectedTemplate?.id &&
    activeXlsxWorkbench?.version.id &&
    xlsxPreview?.templateId === selectedTemplate.id &&
    xlsxPreview.versionId === activeXlsxWorkbench.version.id
    ? xlsxPreview.id
    : null
}

export function buildXlsxBindingManifestForSave(
  manifest: XlsxBindingManifest,
): XlsxBindingManifest {
  return {
    ...manifest,
    requiredFields: manifest.scalarBindings
      .filter((binding) => binding.required)
      .map((binding) => binding.fieldPath),
    governedFields: manifest.scalarBindings
      .filter((binding) => binding.governed !== false)
      .map((binding) => binding.fieldPath),
  }
}

export function updateXlsxScalarBinding(
  workbench: XlsxWorkbenchState,
  bindingId: string,
  patch: Partial<XlsxScalarBinding>,
): XlsxWorkbenchState {
  return {
    ...workbench,
    manifest: {
      ...workbench.manifest,
      scalarBindings: workbench.manifest.scalarBindings.map((binding) =>
        binding.id === bindingId ? { ...binding, ...patch } : binding,
      ),
    },
  }
}

export function parseOptionalPositiveInt(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function parseCertificateTemplatePriority(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : 0
}

export function buildXlsxAssignmentPayload(draft: XlsxAssignmentDraft) {
  return {
    certificateType: 'calibration' as const,
    priority: parseCertificateTemplatePriority(draft.priority),
    unitId: parseOptionalPositiveInt(draft.unitId),
    serviceId: parseOptionalPositiveInt(draft.serviceId),
    methodId: parseOptionalPositiveInt(draft.methodId),
  }
}

export function formatCertificateTemplateDateTime(
  value?: string | null,
): string {
  if (!value) return 'Nunca'

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function getXlsxStatusLabel(status?: string | null): string {
  switch (status) {
    case 'PUBLISHED':
      return 'Publicado'
    case 'VALIDATED':
      return 'Validado'
    case 'ARCHIVED':
      return 'Arquivado'
    case 'DRAFT':
      return 'Rascunho'
    default:
      return status ?? 'Sem XLSX'
  }
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back for insecure origins or denied clipboard permission.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}
