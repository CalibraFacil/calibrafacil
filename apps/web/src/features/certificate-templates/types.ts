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
  engine?: 'xlsx' | 'wysiwyg'
  documentSha256?: string | null
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

// ---- wysiwyg engine (epic wysiwyg) ----

export interface PlaceholderCatalogEntry {
  path: string
  label: string
  group: string
  type: 'text' | 'number' | 'date' | 'boolean'
  source: string
  required: boolean
  format: string
  instrumentSpecific?: boolean
}

export interface PlaceholderCatalogResponse {
  items: PlaceholderCatalogEntry[]
  lockedBlocks: string[]
  compilerVersion: string
}

export interface WysiwygVersionDetail {
  id: number
  templateId: number
  version: number
  status: string
  engine: 'wysiwyg'
  documentJson: Record<string, unknown>
  documentSha256: string
  validationResult: {
    ok?: boolean
    issues?: Array<{ path: string; message: string }>
  } | null
  publishedAt: string | null
  updatedAt: string | null
}

export interface WysiwygDocumentResponse {
  item: WysiwygVersionDetail
}
