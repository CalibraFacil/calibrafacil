export const METHOD_DEFINITION_CORE_VERSION = "0.1.0";
export const METHOD_ENGINE_PACKAGE_NAME = "@calibra-facil/math-engine";

export type NumericInput = string | number;

export type FormulaEvaluationResultLike = {
  value: string | number;
  valueText?: string;
  diagnostics?: readonly unknown[];
  variables: readonly string[];
  normalizedFormula: string;
  normalizedAst?: string;
  formulaFingerprint: string;
  calculationFingerprint?: string;
};

export type CompiledFormulaLike = {
  normalizedFormula: string;
  formulaFingerprint: string;
  variables: readonly string[];
  evaluate(
    inputs: Readonly<Record<string, NumericInput>>,
    options?: Record<string, unknown>,
  ): FormulaEvaluationResultLike;
};

export type MeasurementModelResultLike = {
  value: string | number;
  combinedStandardUncertainty: string | number;
  expandedUncertainty: string | number;
  coverageFactor: string | number;
  coverageProbability: number;
  effectiveDegreesOfFreedom: string | number;
  sensitivityCoefficients: Record<string, string | number>;
  uncertaintyBudget: readonly unknown[];
  diagnostics: readonly unknown[];
  formulaFingerprint: string;
  calculationFingerprint: string;
  canonicalResultJson: string;
  normalizedFormula: string;
  normalizedAst: string;
};

export type InputQuantityLike = {
  estimate?: NumericInput;
  value?: NumericInput;
  unit?: string;
  standardUncertainty?: NumericInput;
  degreesOfFreedom?: NumericInput | "Infinity";
  distribution?: string;
  sensitivityCoefficient?: NumericInput;
  repeatedObservations?: readonly NumericInput[];
  typeB?: Record<string, unknown>;
  halfWidth?: NumericInput;
  lowerLimit?: NumericInput;
  upperLimit?: NumericInput;
  expandedUncertainty?: NumericInput;
  coverageFactor?: NumericInput;
  metadata?: SafeMetadata;
};

export type MeasurementModelInputLike = {
  formula: string;
  quantities: Readonly<Record<string, InputQuantityLike>>;
  correlations?:
    | readonly unknown[]
    | Record<string, Record<string, NumericInput>>;
  covariances?:
    | readonly unknown[]
    | Record<string, Record<string, NumericInput>>;
  coverageProbability?: number;
  coverageFactor?: NumericInput;
  allowNonSmoothWithExplicitSensitivities?: boolean;
};

export type CalculationEngineLike = {
  options?: object;
  compileFormula(
    expression: string,
    options?: { allowedVariables?: readonly string[] },
  ): CompiledFormulaLike;
  evaluateFormula(
    expression: string | CompiledFormulaLike,
    inputs: Readonly<Record<string, NumericInput>>,
    options?: Record<string, unknown>,
  ): FormulaEvaluationResultLike;
  evaluateMeasurementModel(
    input: MeasurementModelInputLike,
  ): MeasurementModelResultLike;
};

export type EngineMetadata = {
  packageName: typeof METHOD_ENGINE_PACKAGE_NAME;
  version: string;
  optionsFingerprint: string;
};

export type SafeMetadataValue = string | number | boolean | null;
export type SafeMetadata = Record<string, SafeMetadataValue>;

export type CalibrationPhase = "before" | "after";
export type CalibrationPhaseMode =
  | "before_and_after"
  | "before_only"
  | "after_only"
  | "not_performed";

export type CalibrationPhaseBlockSnapshot = {
  mode: CalibrationPhaseMode;
  reason?: string | null;
};

export type CalibrationPhaseSnapshot = {
  blocks: Record<string, CalibrationPhaseBlockSnapshot>;
  recordedAt?: string;
  recordedBy?: string;
};

export type MethodDraftStatus =
  | "draft"
  | "ready_for_review"
  | "under_review"
  | "published"
  | "superseded"
  | "deprecated"
  | "archived";

export type MethodDiagnosticSeverity = "info" | "warning" | "error";

export type MethodDiagnostic = {
  code: string;
  severity: MethodDiagnosticSeverity;
  message: string;
  path?: string;
  details?: Record<string, SafeMetadataValue>;
};

export type NumericConstraints = {
  min?: number;
  max?: number;
  integer?: boolean;
};

export type ScalarInput = {
  kind: "scalar";
  key: string;
  label: string;
  quantityKind?:
    | "indication"
    | "reference"
    | "environment"
    // Delta-valued roles: convert factor-only for affine kinds (temperature).
    | "correction"
    | "tolerance"
    | "uncertainty"
    | "resolution"
    | "other";
  unit?: string;
  required: boolean;
  defaultValue?: string | number;
  constraints?: NumericConstraints;
  metadata?: SafeMetadata;
};

export type RepeatedObservationInput = {
  kind: "repeated_observation";
  key: string;
  label: string;
  unit?: string;
  minCount: number;
  maxCount?: number;
  required: boolean;
  typeA?: {
    enabled: boolean;
    minDegreesOfFreedom?: number;
  };
  metadata?: SafeMetadata;
};

export type TableColumn = {
  key: string;
  label: string;
  type: "text" | "number";
  unit?: string;
  role?: "standard_value" | "mass_standard_composition";
  quantityKind?:
    | "indication"
    | "reference"
    | "environment"
    | "correction"
    | "tolerance"
    | "uncertainty"
    | "resolution"
    | "other";
  phase?: CalibrationPhase | "always";
  includeInCertificate?: boolean;
  massComposition?: {
    targetUnit?: "mg" | "g" | "kg";
    optionSource?: "certified_values" | "composition_profiles";
    targetColumns?: {
      certifiedValue?: string;
      compositionLabel?: string;
      expandedUncertainty?: string;
      maxError?: string;
      drift?: string;
      buoyancy?: string;
    };
    uncertaintyMode?: "expanded_rss" | "expanded_arithmetic";
    quantityMode?: "linear_per_item_then_rss" | "profile_linear";
  };
  // Discipline-agnostic per-row certified-value binding (parallel to, NOT a
  // replacement for, massComposition). A `role:"standard_value"` column matches
  // each row to a reference standard's certifiedValue (by nominal) and fills the
  // named target columns from it. No composition profiles, buoyancy, or mass-unit
  // model — works for force/voltage/frequency/etc. The columns stay editable
  // (manual fallback).
  standardValue?: {
    matchBy?: "nominal";
    targetColumns?: {
      value?: string;
      expandedUncertainty?: string;
      coverageFactor?: string;
      drift?: string;
    };
  };
  required?: boolean;
  metadata?: SafeMetadata;
};

export type TableInput = {
  kind: "table";
  key: string;
  label: string;
  minRows?: number;
  maxRows?: number;
  columns: TableColumn[];
  required?: boolean;
  metadata?: SafeMetadata;
};

export type SelectInput = {
  kind: "select";
  key: string;
  label: string;
  options: string[];
  required: boolean;
  defaultValue?: string;
  metadata?: SafeMetadata;
};

export type BooleanInput = {
  kind: "boolean";
  key: string;
  label: string;
  required: boolean;
  defaultValue?: boolean;
  metadata?: SafeMetadata;
};

export type TextInput = {
  kind: "text";
  key: string;
  label: string;
  required: boolean;
  defaultValue?: string;
  metadata?: SafeMetadata;
};

export type MethodInput =
  | ScalarInput
  | RepeatedObservationInput
  | TableInput
  | SelectInput
  | BooleanInput
  | TextInput;

export type MethodFormula = {
  key: string;
  label: string;
  expression: string;
  scope?: FormulaScope;
  outputUnit?: string;
  outputKind?:
    | "correction"
    | "error"
    | "derived_quantity"
    | "display"
    | "intermediate";
  required: boolean;
  dependencies?: string[];
  reporting?: {
    includeInCertificate?: boolean;
    role?:
      | "primary_result"
      /**
       * The instrument's mean indication at the point, as distinct from the
       * error derived from it. Both used to be "primary_result", which left a
       * fixed layout unable to tell which column was which — the XLSX path
       * papered over it by having a human bind each cell by hand. A generic
       * certificate layout has to be told, so it is declared.
       */
      | "mean_indication"
      /** The reference/conventional true value applied at the point (VVC). */
      | "reference_value"
      | "expanded_uncertainty"
      | "coverage_factor"
      | "conformity_margin"
      | "conformity_verdict"
      | "uncertainty_component"
      | "auxiliary";
    group?: "calibration_result" | "uncertainty_budget" | "raw_calculation";
    phase?: CalibrationPhase;
  };
  metadata?: SafeMetadata;
};

export type FormulaScope =
  | { kind: "scalar" }
  | { kind: "table_row"; tableKey: string };

export type TypeAUncertaintySource = {
  kind: "type_a";
  observationsInputKey?: string;
  observations?: QuantitySource[];
  minDegreesOfFreedom?: number;
};

export type TypeBUncertaintySource = {
  kind: "type_b";
  distribution: "normal" | "rectangular" | "triangular" | "u_shaped" | "custom";
  standardUncertainty?: string | number;
  halfWidth?: string | number;
  limits?: {
    lower: string | number;
    upper: string | number;
  };
  divisor?: string | number;
  coverageFactor?: string | number;
  expandedUncertainty?: string | number;
  degreesOfFreedom?: number;
};

export type DirectStandardUncertaintySource = {
  kind: "direct_standard_uncertainty";
  standardUncertainty: string | number;
  degreesOfFreedom?: number | "Infinity";
};

export type MethodQuantity = {
  symbol: string;
  source: QuantitySource;
  unit?: string;
  uncertainty:
    | TypeAUncertaintySource
    | TypeBUncertaintySource
    | DirectStandardUncertaintySource;
  degreesOfFreedom?: number | "Infinity";
  sensitivity?: string | number;
  metadata?: SafeMetadata;
};

export type QuantitySource =
  | { kind: "input"; key: string }
  | { kind: "formula"; key: string }
  | { kind: "table_column"; tableKey: string; columnKey: string }
  | { kind: "constant"; value: string | number };

export type MethodCorrelation = {
  symbols: [string, string];
  coefficient: string | number;
};

export type MethodCovariance = {
  symbols: [string, string];
  covariance: string | number;
};

export type MethodMeasurementModel = {
  key: string;
  label: string;
  scope?: FormulaScope;
  measurand: string;
  expression: string;
  quantities: MethodQuantity[];
  correlations?: MethodCorrelation[];
  covariances?: MethodCovariance[];
  coverageProbability?: number;
  coverageFactor?: string | number;
  outputUnit?: string;
  options?: {
    allowNonSmoothWithExplicitSensitivities?: boolean;
  };
  metadata?: SafeMetadata;
};

export type MethodAcceptanceCriterion = {
  key: string;
  label: string;
  expression: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  metadata?: SafeMetadata;
};

export type MethodPreviewScenario = {
  key: string;
  label: string;
  inputs: Record<string, unknown>;
  calibrationPhases?: CalibrationPhaseSnapshot;
  expected?: {
    formulas?: Record<string, string | number | readonly (string | number)[]>;
    measurementModels?: Record<
      string,
      {
        estimate?: string | number | readonly (string | number)[];
        standardUncertainty?: string | number | readonly (string | number)[];
        expandedUncertainty?: string | number | readonly (string | number)[];
      }
    >;
  };
  expectFailure?: boolean;
};

export type MethodMetadata = SafeMetadata & {
  validationStatus?: "pending_revalidation" | "validated" | "not_validated";
};

export type MethodDraft = {
  id: string;
  version: number;
  status: MethodDraftStatus;
  name: string;
  description?: string;
  assetTypeId?: string;
  discipline?: string;
  inputs: MethodInput[];
  formulas: MethodFormula[];
  measurementModels: MethodMeasurementModel[];
  acceptanceCriteria: MethodAcceptanceCriterion[];
  previewScenarios: MethodPreviewScenario[];
  metadata: MethodMetadata;
};

export type NormalizedMethodInput = MethodInput;
export type NormalizedQuantity = MethodQuantity;
export type NormalizedAcceptanceCriterion = MethodAcceptanceCriterion & {
  normalizedFormula: string;
  variables: string[];
  criterionFingerprint: string;
};

export type CompiledFormulaDefinition = {
  key: string;
  label: string;
  expression: string;
  scope?: FormulaScope;
  normalizedFormula: string;
  formulaFingerprint: string;
  variables: string[];
  outputUnit?: string;
  outputKind?: MethodFormula["outputKind"];
  reporting?: MethodFormula["reporting"];
  metadata?: SafeMetadata;
};

export type CompiledMeasurementModelDefinition = {
  key: string;
  formulaKey?: string;
  scope?: FormulaScope;
  expression: string;
  normalizedFormula: string;
  modelFingerprint: string;
  quantities: NormalizedQuantity[];
  correlations?: MethodCorrelation[];
  covariances?: MethodCovariance[];
  coverageProbability?: number;
  coverageFactor?: string | number;
  options?: MethodMeasurementModel["options"];
  metadata?: SafeMetadata;
};

export type CompiledMethod = {
  methodId: string;
  methodVersion: number;
  status: "compiled";
  engine: {
    packageName: "@calibra-facil/math-engine";
    version: string;
    optionsFingerprint: string;
  };
  coreVersion: string;
  normalizedMethodJson: string;
  methodFingerprint: string;
  inputs: NormalizedMethodInput[];
  formulas: CompiledFormulaDefinition[];
  measurementModels: CompiledMeasurementModelDefinition[];
  acceptanceCriteria: NormalizedAcceptanceCriterion[];
  diagnostics: MethodDiagnostic[];
};

export type FormulaPreviewResult = {
  key: string;
  value: string | number | readonly (string | number)[];
  normalizedFormula: string;
  formulaFingerprint: string;
};

export type MeasurementModelPreviewResult = {
  key: string;
  result: MeasurementModelResultLike | readonly MeasurementModelResultLike[];
};

export type AcceptanceCriterionPreviewResult = {
  key: string;
  passed: boolean;
  severity: MethodAcceptanceCriterion["severity"];
  message: string;
};

export type MethodPreviewResult = {
  scenarioKey: string;
  passed: boolean;
  formulaResults: FormulaPreviewResult[];
  measurementModelResults: MeasurementModelPreviewResult[];
  acceptanceCriteriaResults: AcceptanceCriterionPreviewResult[];
  diagnostics: MethodDiagnostic[];
};

export type CompiledMethodExecutionInput = {
  inputs: Record<string, unknown>;
  calibrationPhases?: CalibrationPhaseSnapshot;
};

export type CompiledMethodExecutionResult = {
  ok: boolean;
  methodFingerprint: string;
  engineVersion: string;
  engineOptionsFingerprint: string;
  inputFingerprint: string;
  formulaResults: FormulaPreviewResult[];
  measurementModelResults: MeasurementModelPreviewResult[];
  acceptanceCriteriaResults: AcceptanceCriterionPreviewResult[];
  diagnostics: MethodDiagnostic[];
  outputs: Record<string, string | number | readonly (string | number)[]>;
  canonicalResultJson: string;
  calculationFingerprint: string;
  resultFingerprint: string;
};

export type CompileMethodOptions = {
  engine: CalculationEngineLike;
  engineMetadata?: EngineMetadata;
  requirePublishable?: boolean;
  previewScenarios?: MethodPreviewScenario[];
  includePreviewScenariosInFingerprint?: boolean;
};

export type CompileMethodResult =
  | {
      ok: true;
      method: CompiledMethod;
      previewResults: MethodPreviewResult[];
      diagnostics: MethodDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: MethodDiagnostic[];
      draft?: MethodDraft;
    };

export type RunMethodPreviewOptions = {
  engine: CalculationEngineLike;
  calibrationPhases?: CalibrationPhaseSnapshot;
};

export type ExecuteCompiledMethodOptions = {
  engine: CalculationEngineLike;
};

export type PreviewInputValue =
  | NumericInput
  | boolean
  | string
  | null
  | readonly NumericInput[]
  | readonly Record<string, unknown>[];
