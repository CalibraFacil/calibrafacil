import type { MethodStatus } from '@calibra-facil/schemas/machines'
import type { DecisionRuleKind } from '@calibra-facil/shared/decision-rule'
import {
  METHOD_QUANTITY_KINDS,
  type ECCENTRICITY_INDICATOR_VARIANTS,
  type ENVIRONMENT_FIELDS,
  type FORMULA_REPORTING_GROUPS,
  type FORMULA_REPORTING_ROLES,
  type GUM_TYPE_B_DISTRIBUTIONS,
  type MASS_COMPOSITION_OPTION_SOURCES,
  type MASS_COMPOSITION_QUANTITY_MODES,
  type MASS_COMPOSITION_UNCERTAINTY_MODES,
  type MASS_UNITS,
  type METHOD_INPUT_FIELD_SOURCES,
  type METHOD_INPUT_FIELD_TYPES,
  type METHOD_TABLE_COLUMN_ROLES,
  type METHOD_TABLE_COLUMN_TYPES,
  type METHOD_VALIDATION_OPERATORS,
  type METHOD_VALIDATION_SEVERITIES,
  type STANDARD_CHANNEL_PROPERTIES,
  type TABLE_STATISTICS,
  type UNCERTAINTY_DISTRIBUTIONS,
} from '@calibra-facil/shared'
type MethodDraftStatus = MethodStatus

export type MethodDraftInputType = (typeof METHOD_INPUT_FIELD_TYPES)[number]

/**
 * Semantic role of a numeric field/column. Delta-valued roles
 * (correction/tolerance/uncertainty/resolution) convert factor-only for affine
 * kinds (temperature) — see DELTA_QUANTITY_KINDS in @calibra-facil/shared.
 * The list is METHOD_QUANTITY_KINDS in @calibra-facil/shared.
 */
export const methodDraftQuantityKinds = METHOD_QUANTITY_KINDS

export type MethodDraftQuantityKind = (typeof methodDraftQuantityKinds)[number]

export type MethodDraftTableColumn = {
  key: string
  label: string
  type: (typeof METHOD_TABLE_COLUMN_TYPES)[number]
  unit?: string
  role?: (typeof METHOD_TABLE_COLUMN_ROLES)[number]
  quantityKind?: MethodDraftQuantityKind
  includeInCertificate?: boolean
  massComposition?: {
    targetUnit?: (typeof MASS_UNITS)[number]
    optionSource?: (typeof MASS_COMPOSITION_OPTION_SOURCES)[number]
    targetColumns?: {
      certifiedValue?: string
      compositionLabel?: string
      expandedUncertainty?: string
      maxError?: string
      drift?: string
      buoyancy?: string
    }
    uncertaintyMode?: (typeof MASS_COMPOSITION_UNCERTAINTY_MODES)[number]
    quantityMode?: (typeof MASS_COMPOSITION_QUANTITY_MODES)[number]
  }
}

interface MethodDraftEccentricityIndicatorConfig {
  enabled?: boolean
  variant?: (typeof ECCENTRICITY_INDICATOR_VARIANTS)[number]
  pointColumn?: string
  loadPoints?: string[]
}

interface MethodDraftWeighingRangeResolverConfig {
  enabled?: boolean
  assetSpecKey?: string
  pointColumn?: string
  pointUnit?: (typeof MASS_UNITS)[number]
  targetColumns?: {
    rangeLabel?: string
    rangeMin?: string
    rangeMax?: string
    rangeUnit?: string
    resolution?: string
    resolutionUnit?: string
  }
}

export type MethodDraftInput = {
  key: string
  label: string
  type: MethodDraftInputType
  unit?: string
  quantityKind?: MethodDraftQuantityKind
  required?: boolean
  options?: Array<string>
  defaultValue?: string | number
  columns?: Array<MethodDraftTableColumn>
  source?: (typeof METHOD_INPUT_FIELD_SOURCES)[number]
  assetSpecKey?: string
  allowOverride?: boolean
  eccentricityIndicator?: MethodDraftEccentricityIndicatorConfig
  weighingRangeResolver?: MethodDraftWeighingRangeResolverConfig
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
      statistic: (typeof TABLE_STATISTICS)[number]
    }
  | {
      key: string
      label?: string
      source: 'environment'
      field: (typeof ENVIRONMENT_FIELDS)[number]
    }
  | {
      key: string
      label?: string
      source: 'standard'
      standardId?: number
      valueKey: string
    }
  | {
      key: string
      label?: string
      source: 'standard_channel'
      standardId?: number
      channelKey: string
      property: (typeof STANDARD_CHANNEL_PROPERTIES)[number]
    }

export type MethodDraftFormula = {
  outputKey: string
  expression: string
  scope?: { kind: 'scalar' } | { kind: 'table_row'; tableKey: string }
  label?: string
  unit?: string
  reporting?: {
    includeInCertificate?: boolean
    role?: (typeof FORMULA_REPORTING_ROLES)[number]
    group?: (typeof FORMULA_REPORTING_GROUPS)[number]
    phase?: 'before' | 'after'
  }
}

export type MethodDraftValidation = {
  leftExpression: string
  operator: (typeof METHOD_VALIDATION_OPERATORS)[number]
  rightExpression: string
  message: string
  severity: (typeof METHOD_VALIDATION_SEVERITIES)[number]
}

export type MethodDraftUncertaintyComponent = {
  name: string
  value: number
  distribution: (typeof UNCERTAINTY_DISTRIBUTIONS)[number]
  coverageFactor?: number
  divisor?: number
  degreesOfFreedom?: number
}

export type MethodDraftMeasurementModelSource =
  | { kind: 'input'; key: string }
  | { kind: 'formula'; key: string }
  | { kind: 'table_column'; tableKey: string; columnKey: string }
  | { kind: 'constant'; value: string | number }

export type MethodDraftMeasurementModelQuantity = {
  symbol: string
  label?: string
  source: MethodDraftMeasurementModelSource
  unit?: string
  uncertainty:
    | {
        kind: 'type_a'
        observationsInputKey?: string
        observations?: Array<MethodDraftMeasurementModelSource>
        minDegreesOfFreedom?: number
      }
    | {
        kind: 'type_b'
        distribution: (typeof GUM_TYPE_B_DISTRIBUTIONS)[number]
        standardUncertainty?: string | number
        halfWidth?: string | number
        limits?: { lower: string | number; upper: string | number }
        divisor?: string | number
        coverageFactor?: string | number
        expandedUncertainty?: string | number
        degreesOfFreedom?: number
      }
    | {
        kind: 'direct_standard_uncertainty'
        standardUncertainty: string | number
        degreesOfFreedom?: number | 'Infinity'
      }
  degreesOfFreedom?: number | 'Infinity'
  sensitivity?: string | number
}

export type MethodDraftMeasurementModel = {
  key: string
  label: string
  scope?: { kind: 'scalar' } | { kind: 'table_row'; tableKey: string }
  measurand: string
  expression: string
  quantities: Array<MethodDraftMeasurementModelQuantity>
  correlations?: Array<{
    symbols: [string, string]
    coefficient: string | number
  }>
  covariances?: Array<{
    symbols: [string, string]
    covariance: string | number
  }>
  coverageProbability?: number
  coverageFactor?: string | number
  outputUnit?: string
  options?: {
    allowNonSmoothWithExplicitSensitivities?: boolean
  }
}

export type MethodDraftCertificateContent = {
  procedureCode?: string
  referenceStandards?: Array<string>
  certifiedValuesDisplay?: 'full' | 'hidden'
  massCompositionDisplay?: 'full' | 'hidden'
  uncertaintyBudgetDisplay?: 'full' | 'hidden'
  decisionRuleStatement?: string
  /** ISO/IEC 17025 7.8.6 / ILAC-G8; absent: undeclared. */
  decisionRuleKind?: DecisionRuleKind
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
  accreditedScope?: boolean
  version: number
  status: MethodDraftStatus
  inputs: Array<MethodDraftInput>
  variables: Array<MethodDraftVariableBinding>
  formulas: Array<MethodDraftFormula>
  measurementModels: Array<MethodDraftMeasurementModel>
  validations: Array<MethodDraftValidation>
  uncertainty: Array<MethodDraftUncertaintyComponent>
  certificate: MethodDraftCertificateContent | null
}

export interface MethodRecordData {
  id?: number
  name: string
  description?: string | null
  assetTypeId?: number | null
  accreditedScope?: boolean | null
  version?: number
  status?: MethodDraftStatus
  dataFields?: Array<MethodDraftInput>
  variableBindings?: Array<MethodDraftVariableBinding>
  formulas?: Array<MethodDraftFormula>
  measurementModels?: Array<MethodDraftMeasurementModel>
  validations?: Array<MethodDraftValidation>
  uncertaintyParams?: Array<MethodDraftUncertaintyComponent>
  certificateContent?: MethodDraftCertificateContent | null
}

export interface MethodDraftSavePayload {
  name: string
  description?: string | null
  assetTypeId?: number | null
  accreditedScope: boolean
  dataFields: Array<MethodDraftInput>
  variableBindings: Array<MethodDraftVariableBinding>
  formulas: Array<MethodDraftFormula>
  measurementModels: Array<MethodDraftMeasurementModel>
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
  scope?: { kind: 'scalar' } | { kind: 'table_row'; tableKey: string }
}

export interface MethodCompileResult {
  diagnostics: Array<MethodDiagnostic>
  fingerprint?: string
  normalizedFormulas: Array<MethodNormalizedFormula>
  compiledMethod?: unknown
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
  measurementModels: [],
  validations: [],
  uncertainty: [],
  certificate: {
    referenceStandards: [],
    sections: [],
  },
}
