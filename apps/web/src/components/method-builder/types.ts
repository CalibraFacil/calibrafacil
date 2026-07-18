export type MethodDraftStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'TECHNICAL_REVIEWED'
  | 'PUBLISHED'
  | 'ARCHIVED'

export type MethodDraftInputType = 'text' | 'number' | 'select' | 'table'

/**
 * Semantic role of a numeric field/column. Delta-valued roles
 * (correction/tolerance/uncertainty/resolution) convert factor-only for affine
 * kinds (temperature) — see DELTA_QUANTITY_KINDS in @calibra-facil/shared.
 * Mirrors the ScalarInput.quantityKind enum in @calibra-facil/method-definition.
 */
export const methodDraftQuantityKinds = [
  'indication',
  'reference',
  'environment',
  'correction',
  'tolerance',
  'uncertainty',
  'resolution',
  'other',
] as const

export type MethodDraftQuantityKind = (typeof methodDraftQuantityKinds)[number]

export interface MethodDraftTableColumn {
  key: string
  label: string
  type: 'text' | 'number'
  unit?: string
  role?: 'standard_value' | 'mass_standard_composition'
  quantityKind?: MethodDraftQuantityKind
  includeInCertificate?: boolean
  massComposition?: {
    targetUnit?: 'mg' | 'g' | 'kg'
    optionSource?: 'certified_values' | 'composition_profiles'
    targetColumns?: {
      certifiedValue?: string
      compositionLabel?: string
      expandedUncertainty?: string
      maxError?: string
      drift?: string
      buoyancy?: string
    }
    uncertaintyMode?: 'expanded_rss' | 'expanded_arithmetic'
    quantityMode?: 'linear_per_item_then_rss' | 'profile_linear'
  }
}

export interface MethodDraftEccentricityIndicatorConfig {
  enabled?: boolean
  variant?: 'circular_platform' | 'road_scale'
  pointColumn?: string
  loadPoints?: string[]
}

export interface MethodDraftWeighingRangeResolverConfig {
  enabled?: boolean
  assetSpecKey?: string
  pointColumn?: string
  pointUnit?: 'mg' | 'g' | 'kg'
  targetColumns?: {
    rangeLabel?: string
    rangeMin?: string
    rangeMax?: string
    rangeUnit?: string
    resolution?: string
    resolutionUnit?: string
  }
}

export interface MethodDraftInput {
  key: string
  label: string
  type: MethodDraftInputType
  unit?: string
  quantityKind?: MethodDraftQuantityKind
  required?: boolean
  options?: Array<string>
  defaultValue?: string | number
  columns?: Array<MethodDraftTableColumn>
  source?: 'manual' | 'asset_spec'
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
  | {
      key: string
      label?: string
      source: 'standard_channel'
      standardId?: number
      channelKey: string
      property:
        | 'value'
        | 'correction'
        | 'uncertainty'
        | 'coverageFactor'
        | 'drift'
    }

export interface MethodDraftFormula {
  outputKey: string
  expression: string
  scope?: { kind: 'scalar' } | { kind: 'table_row'; tableKey: string }
  label?: string
  unit?: string
  reporting?: {
    includeInCertificate?: boolean
    role?:
      | 'primary_result'
      | 'expanded_uncertainty'
      | 'coverage_factor'
      | 'conformity_margin'
      | 'conformity_verdict'
      | 'uncertainty_component'
      | 'auxiliary'
    group?: 'calibration_result' | 'uncertainty_budget' | 'raw_calculation'
    phase?: 'before' | 'after'
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

export type MethodDraftMeasurementModelSource =
  | { kind: 'input'; key: string }
  | { kind: 'formula'; key: string }
  | { kind: 'table_column'; tableKey: string; columnKey: string }
  | { kind: 'constant'; value: string | number }

export interface MethodDraftMeasurementModelQuantity {
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
        distribution:
          | 'normal'
          | 'rectangular'
          | 'triangular'
          | 'u_shaped'
          | 'custom'
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

export interface MethodDraftMeasurementModel {
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

export interface MethodDraftCertificateContent {
  procedureCode?: string
  referenceStandards?: Array<string>
  certifiedValuesDisplay?: 'full' | 'hidden'
  massCompositionDisplay?: 'full' | 'hidden'
  uncertaintyBudgetDisplay?: 'full' | 'hidden'
  decisionRuleStatement?: string
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
