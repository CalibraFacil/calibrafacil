export type MethodDraftStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'TECHNICAL_REVIEWED'
  | 'PUBLISHED'
  | 'ARCHIVED'

export type MethodDraftInputType = 'text' | 'number' | 'select' | 'table'

export interface MethodDraftTableColumn {
  key: string
  label: string
  type: 'text' | 'number'
  unit?: string
}

export interface MethodDraftInput {
  key: string
  label: string
  type: MethodDraftInputType
  unit?: string
  required?: boolean
  options?: Array<string>
  defaultValue?: string | number
  columns?: Array<MethodDraftTableColumn>
  source?: 'manual' | 'asset_spec'
  assetSpecKey?: string
  allowOverride?: boolean
}

export type MethodDraftVariableBinding =
  | {
      key: string
      label?: string
      source: 'data_field'
      fieldKey: string
    }
  | {
      key: string
      label?: string
      source: 'table_column'
      fieldKey: string
      columnKey: string
    }
  | {
      key: string
      label?: string
      source: 'table_statistic'
      fieldKey: string
      columnKey: string
      statistic: 'mean' | 'sample_stddev' | 'count' | 'min' | 'max'
    }
  | {
      key: string
      label?: string
      source: 'environment'
      field: 'temperature' | 'humidity' | 'pressure'
    }
  | {
      key: string
      label?: string
      source: 'standard'
      standardId?: number
      valueKey: string
    }

export interface MethodDraftFormula {
  outputKey: string
  expression: string
  label?: string
  unit?: string
  reporting?: {
    includeInCertificate?: boolean
    role?:
      | 'primary_result'
      | 'expanded_uncertainty'
      | 'coverage_factor'
      | 'conformity_margin'
      | 'uncertainty_component'
      | 'auxiliary'
    group?: 'calibration_result' | 'uncertainty_budget' | 'raw_calculation'
  }
}

export interface MethodDraftValidation {
  leftExpression: string
  operator: '<' | '<=' | '>' | '>=' | '==' | '!='
  rightExpression: string
  message: string
  severity: 'error' | 'warning'
}

export interface MethodDraftUncertaintyComponent {
  name: string
  value: number
  distribution: 'normal' | 'rectangular' | 'triangular' | 'u-shaped'
  coverageFactor?: number
  divisor?: number
  degreesOfFreedom?: number
}

export interface MethodDraftCertificateContent {
  procedureCode?: string
  referenceStandards?: Array<string>
  certifiedValuesDisplay?: 'full' | 'hidden'
  massCompositionDisplay?: 'full' | 'hidden'
  uncertaintyBudgetDisplay?: 'full' | 'hidden'
  sections?: Array<
    | {
        kind: 'paragraphs'
        title: string
        paragraphs: Array<string>
      }
    | {
        kind: 'definition_list'
        title: string
        items: Array<{ term: string; definition: string }>
      }
    | {
        kind: 'bullets'
        title?: string
        items: Array<string>
      }
  >
}

export interface MethodDraft {
  id?: number
  name: string
  description?: string
  assetTypeId?: number
  version: number
  status: MethodDraftStatus
  inputs: Array<MethodDraftInput>
  variables: Array<MethodDraftVariableBinding>
  formulas: Array<MethodDraftFormula>
  validations: Array<MethodDraftValidation>
  uncertainty: Array<MethodDraftUncertaintyComponent>
  certificate: MethodDraftCertificateContent | null
}

export interface LegacyMethodData {
  id?: number
  name: string
  description?: string | null
  assetTypeId?: number | null
  version?: number
  status?: MethodDraftStatus
  dataFields?: Array<MethodDraftInput>
  variableBindings?: Array<MethodDraftVariableBinding>
  formulas?: Array<MethodDraftFormula>
  validations?: Array<MethodDraftValidation>
  uncertaintyParams?: Array<MethodDraftUncertaintyComponent>
  certificateContent?: MethodDraftCertificateContent | null
}

export interface MethodDraftSavePayload {
  name: string
  description?: string
  assetTypeId?: number
  dataFields: Array<MethodDraftInput>
  variableBindings: Array<MethodDraftVariableBinding>
  formulas: Array<MethodDraftFormula>
  validations: Array<MethodDraftValidation>
  uncertaintyParams: Array<MethodDraftUncertaintyComponent>
  certificateContent: MethodDraftCertificateContent | null
}

export type MethodDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface MethodDiagnostic {
  code?: string
  severity: MethodDiagnosticSeverity
  message: string
  path?: string
}

export interface MethodNormalizedFormula {
  outputKey: string
  expression: string
  normalizedExpression: string
}

export interface MethodCompileResult {
  diagnostics: Array<MethodDiagnostic>
  fingerprint?: string
  normalizedFormulas: Array<MethodNormalizedFormula>
  compiledDraft?: unknown
}

export interface MethodPreviewResult {
  diagnostics: Array<MethodDiagnostic>
  results: Record<string, unknown>
  normalizedData?: Record<string, unknown>
}

export const emptyMethodDraft: MethodDraft = {
  name: '',
  description: '',
  version: 1,
  status: 'DRAFT',
  inputs: [
    {
      key: 'measurement',
      label: 'Medição',
      type: 'number',
      unit: '',
      required: true,
    },
  ],
  variables: [],
  formulas: [],
  validations: [],
  uncertainty: [],
  certificate: {
    referenceStandards: [],
    sections: [],
  },
}

