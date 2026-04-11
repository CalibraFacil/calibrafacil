/**
 * Types for the Method Builder component
 */

export type MethodInputType = 'text' | 'number' | 'select' | 'table'
export type MethodInputSource = 'manual' | 'asset_spec'

export interface MethodTableColumn {
  key: string
  label: string
  type: 'text' | 'number'
  unit?: string
}

export interface MethodInputField {
  key: string
  label: string
  type: MethodInputType
  unit?: string
  required?: boolean
  options?: Array<string>
  defaultValue?: string | number
  columns?: Array<MethodTableColumn>
  source?: MethodInputSource
  assetSpecKey?: string
  allowOverride?: boolean
}

export interface MethodFormulaReporting {
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

export interface MethodFormula {
  outputKey: string
  expression: string
  label?: string
  unit?: string
  reporting?: MethodFormulaReporting
}

export interface MethodValidation {
  expression: string
  message: string
  severity: 'error' | 'warning'
}

export interface MethodTypeBComponent {
  name: string
  value: number
  distribution: 'normal' | 'rectangular' | 'triangular' | 'u-shaped'
  coverageFactor?: number
  divisor?: number
  degreesOfFreedom?: number
}

export type MethodStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'TECHNICAL_REVIEWED'
  | 'PUBLISHED'
  | 'ARCHIVED'

export interface MethodData {
  id?: number
  name: string
  description?: string
  assetTypeId?: number
  version: number
  status: MethodStatus
  technicalReviewedBy?: string | null
  approvedBy?: string | null
  dataFields: Array<MethodInputField>
  formulas: Array<MethodFormula>
  validations: Array<MethodValidation>
  uncertaintyParams: Array<MethodTypeBComponent>
}

export interface FormulaResult {
  // Value is stored as string or string[] to preserve BigNumber precision
  // This prevents "Cannot convert >15 significant digits" errors when chaining
  value?: string | Array<string>
  displayValue?: string
  error?: string
}

export interface ValidationResult {
  expression: string
  message: string
  severity: 'error' | 'warning'
  passed?: boolean
  error?: string
}

// Default empty method for new methods
export const defaultMethodData: MethodData = {
  name: '',
  description: '',
  version: 1,
  status: 'DRAFT',
  dataFields: [],
  formulas: [],
  validations: [],
  uncertaintyParams: [],
}
