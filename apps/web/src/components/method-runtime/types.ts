/**
 * Types for the Method Builder component
 */

export type MethodInputType = 'text' | 'number' | 'select' | 'table'
export type MethodInputSource = 'manual' | 'asset_spec'
export type EccentricityIndicatorVariant = 'circular_platform' | 'road_scale'

export interface EccentricityIndicatorConfig {
  enabled?: boolean
  variant?: EccentricityIndicatorVariant
  pointColumn?: string
  loadPoints?: string[]
}

export interface WeighingRangeResolverConfig {
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

export type MethodTableColumnRole =
  | 'standard_value'
  | 'mass_standard_composition'

export interface MassCompositionConfig {
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

/**
 * Discipline-agnostic per-row certified-value binding for `standard_value`
 * columns (parallel to MassCompositionConfig, not a replacement). Matches each
 * row to a reference standard's certifiedValue by nominal and fills the named
 * target columns. No composition profiles / buoyancy / mass-unit model.
 */
export interface StandardValueConfig {
  matchBy?: 'nominal'
  targetColumns?: {
    value?: string
    expandedUncertainty?: string
    coverageFactor?: string
    drift?: string
  }
}

export interface MethodTableColumn {
  key: string
  label: string
  type: 'text' | 'number'
  unit?: string
  role?: MethodTableColumnRole
  /** Semantic role; delta-valued roles convert factor-only for affine kinds. */
  quantityKind?: string
  phase?: 'before' | 'after' | 'always'
  massComposition?: MassCompositionConfig
  standardValue?: StandardValueConfig
}

export interface MethodInputField {
  key: string
  label: string
  type: MethodInputType
  unit?: string
  /** Semantic role; delta-valued roles convert factor-only for affine kinds. */
  quantityKind?: string
  required?: boolean
  options?: Array<string>
  defaultValue?: string | number
  columns?: Array<MethodTableColumn>
  source?: MethodInputSource
  assetSpecKey?: string
  allowOverride?: boolean
  phaseBlockKey?: string
  phaseBlockLabel?: string
  eccentricityIndicator?: EccentricityIndicatorConfig
  weighingRangeResolver?: WeighingRangeResolverConfig
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
  scope?: { kind: 'scalar' } | { kind: 'table_row'; tableKey: string }
  label?: string
  unit?: string
  reporting?: MethodFormulaReporting
  metadata?: Record<string, unknown>
}

export interface MethodValidation {
  leftExpression: string
  operator: '<' | '<=' | '>' | '>=' | '==' | '!='
  rightExpression: string
  message: string
  severity: 'error' | 'warning'
  metadata?: Record<string, unknown>
}

export type MethodVariableBinding =
  | {
      key: string
      label?: string
      source: 'data_field'
      fieldKey: string
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
      source: 'table_column'
      fieldKey: string
      columnKey: string
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

export interface MethodTypeBComponent {
  name: string
  value: number
  distribution: 'normal' | 'rectangular' | 'triangular' | 'u-shaped'
  coverageFactor?: number
  divisor?: number
  degreesOfFreedom?: number
}

export type MethodCertificateContentSection =
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

export interface MethodCertificateContent {
  procedureCode?: string
  referenceStandards?: Array<string>
  certifiedValuesDisplay?: 'full' | 'hidden'
  massCompositionDisplay?: 'full' | 'hidden'
  uncertaintyBudgetDisplay?: 'full' | 'hidden'
  sections?: Array<MethodCertificateContentSection>
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
  variableBindings?: Array<MethodVariableBinding>
  formulas: Array<MethodFormula>
  validations: Array<MethodValidation>
  uncertaintyParams: Array<MethodTypeBComponent>
  certificateContent?: MethodCertificateContent | null
  compiledMethod?: unknown
  methodFingerprint?: string | null
  methodEngine?: { version?: string; optionsFingerprint?: string } | null
  methodCompiledAt?: string | null
  publicationEvidence?: {
    publicationFingerprint?: string
    previewResults?: Array<unknown>
    diagnostics?: Array<unknown>
    engineVersion?: string
    engineOptionsFingerprint?: string
    compiledAt?: string
  } | null
}

export interface FormulaResult {
  value?: string | number | Array<string | number>
  valueText?: string
  displayValue?: string
  error?: string
  errorCode?: string
}

export interface ValidationResult {
  leftExpression: string
  operator: MethodValidation['operator']
  rightExpression: string
  message: string
  severity: 'error' | 'warning'
  passed?: boolean
  error?: string
  errorCode?: string
}

// Default empty method for new methods
export const defaultMethodData: MethodData = {
  name: '',
  description: '',
  version: 1,
  status: 'DRAFT',
  dataFields: [],
  variableBindings: [],
  formulas: [],
  validations: [],
  uncertaintyParams: [],
  certificateContent: {
    referenceStandards: [],
    sections: [],
  },
}
