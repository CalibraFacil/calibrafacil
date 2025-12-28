/**
 * Types for the Method Builder component
 */

export type MethodInputType = 'text' | 'number' | 'select' | 'table'

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
}

export interface MethodFormula {
  outputKey: string
  expression: string
  label?: string
  unit?: string
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

export type MethodStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface MethodData {
  id?: number
  name: string
  description?: string
  assetTypeId?: number
  version: number
  status: MethodStatus
  dataFields: Array<MethodInputField>
  formulas: Array<MethodFormula>
  validations: Array<MethodValidation>
  uncertaintyParams: Array<MethodTypeBComponent>
}

export interface FormulaResult {
  value?: number
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
