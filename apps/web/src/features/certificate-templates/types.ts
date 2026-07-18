export interface TemplateItem {
  id: number | null
  name: string
  slug: string
  version: number
  status: string
  isDefault: boolean
  createdAt: string | null
  updatedAt: string | null
  currentXlsxVersion?: XlsxVersionSummary | null
}

export interface TemplateListResponse {
  canManage: boolean
  items: TemplateItem[]
}

export interface WorkbookPlaceholder {
  sheet: string
  cell: string
  token: string
  fieldPath: string
}

export interface WorkbookWarning {
  code: string
  message: string
  sheet?: string
  cell?: string
  fieldPath?: string
}

export interface WorkbookAnalysis {
  sheets: Array<{
    name: string
    usedRange?: string
    printArea?: string | null
    namedRanges: string[]
    placeholders: WorkbookPlaceholder[]
  }>
  warnings: WorkbookWarning[]
}

export interface XlsxVersionSummary {
  id: number
  templateId: number
  version: number
  status: string
  xlsxSha256: string | null
  bindingManifestSha256: string | null
  sheetCount?: number
  placeholderCount?: number
  warningCount?: number
  createdAt?: string | null
  updatedAt?: string | null
  publishedAt?: string | null
}

export interface XlsxScalarBinding {
  id: string
  sheet: string
  cell: string
  fieldPath: string
  formatter?: string
  required?: boolean
  governed?: boolean
}

export interface XlsxBindingManifest {
  schemaVersion: 'calibrafacil.certificateXlsxBinding.v1'
  requiredFields: string[]
  governedFields: string[]
  scalarBindings: XlsxScalarBinding[]
  imageBindings: unknown[]
  tableBindings: unknown[]
  renderPolicy: {
    formulas: 'preserve' | 'rejectVolatile'
    macros: 'reject'
    externalLinks: 'reject'
    converter: 'gotenberg-libreoffice'
  }
}

export interface XlsxPreviewItem {
  id: number
  status: string
  error?: string | null
}

export interface XlsxPreviewReference {
  id: number
  templateId: number
  versionId: number
}

export interface XlsxWorkbenchState {
  version: XlsxVersionSummary
  analysis: WorkbookAnalysis
  manifest: XlsxBindingManifest
}

export type XlsxPreviewResponse = {
  item: XlsxPreviewItem
  pdfUrl?: string | null
}

export type XlsxAssignmentOption = {
  id: number
  label: string
  detail?: string | null
}
