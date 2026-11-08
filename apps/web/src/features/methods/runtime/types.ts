import type { MethodStatus } from '@calibra-facil/schemas/machines'
import type { MeasurementUnit } from '@calibra-facil/shared/units'
import type {
  CERTIFICATE_SECTION_DISPLAYS,
  ECCENTRICITY_INDICATOR_VARIANTS,
  ENVIRONMENT_FIELDS,
  FORMULA_REPORTING_GROUPS,
  MASS_COMPOSITION_OPTION_SOURCES,
  MASS_COMPOSITION_QUANTITY_MODES,
  MASS_COMPOSITION_UNCERTAINTY_MODES,
  MASS_UNITS,
  METHOD_COLUMN_PHASES,
  METHOD_INPUT_FIELD_SOURCES,
  METHOD_INPUT_FIELD_TYPES,
  METHOD_TABLE_COLUMN_ROLES,
  METHOD_TABLE_COLUMN_TYPES,
  METHOD_VALIDATION_OPERATORS,
  METHOD_VALIDATION_SEVERITIES,
  STANDARD_CHANNEL_PROPERTIES,
  TABLE_STATISTICS,
  UNCERTAINTY_DISTRIBUTIONS,
} from '@calibra-facil/shared'

/**
 * Types for the Method Builder component
 */

export type MethodInputType = (typeof METHOD_INPUT_FIELD_TYPES)[number]
type MethodInputSource = (typeof METHOD_INPUT_FIELD_SOURCES)[number]
type EccentricityIndicatorVariant =
  (typeof ECCENTRICITY_INDICATOR_VARIANTS)[number]

interface EccentricityIndicatorConfig {
  enabled?: boolean
  variant?: EccentricityIndicatorVariant
  pointColumn?: string
  loadPoints?: string[]
}

interface WeighingRangeResolverConfig {
  enabled?: boolean
  assetSpecKey?: string
  pointColumn?: string
  pointUnit?: MeasurementUnit
  targetColumns?: {
    rangeLabel?: string
    rangeMin?: string
    rangeMax?: string
    rangeUnit?: string
    resolution?: string
    resolutionUnit?: string
  }
}

type MethodTableColumnRole = (typeof METHOD_TABLE_COLUMN_ROLES)[number]

interface MassCompositionConfig {
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
  type: (typeof METHOD_TABLE_COLUMN_TYPES)[number]
  unit?: string
  role?: MethodTableColumnRole
  /** Semantic role; delta-valued roles convert factor-only for affine kinds. */
  quantityKind?: string
  phase?: (typeof METHOD_COLUMN_PHASES)[number]
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

interface MethodFormulaReporting {
  includeInCertificate?: boolean
  role?:
    | 'primary_result'
    | 'expanded_uncertainty'
    | 'coverage_factor'
    | 'conformity_margin'
    | 'conformity_verdict'
    | 'uncertainty_component'
    | 'auxiliary'
  group?: (typeof FORMULA_REPORTING_GROUPS)[number]
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
  operator: (typeof METHOD_VALIDATION_OPERATORS)[number]
  rightExpression: string
  message: string
  severity: (typeof METHOD_VALIDATION_SEVERITIES)[number]
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
      statistic: (typeof TABLE_STATISTICS)[number]
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

interface MethodTypeBComponent {
  name: string
  value: number
  distribution: (typeof UNCERTAINTY_DISTRIBUTIONS)[number]
  coverageFactor?: number
  divisor?: number
  degreesOfFreedom?: number
}

type MethodCertificateContentSection =
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

interface MethodCertificateContent {
  procedureCode?: string
  referenceStandards?: Array<string>
  certifiedValuesDisplay?: (typeof CERTIFICATE_SECTION_DISPLAYS)[number]
  massCompositionDisplay?: (typeof CERTIFICATE_SECTION_DISPLAYS)[number]
  uncertaintyBudgetDisplay?: (typeof CERTIFICATE_SECTION_DISPLAYS)[number]
  sections?: Array<MethodCertificateContentSection>
}

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
