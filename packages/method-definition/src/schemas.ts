import {
  ACCEPTANCE_CRITERION_SEVERITIES,
  FORMULA_REPORTING_GROUPS,
  FORMULA_REPORTING_ROLES,
  GUM_TYPE_B_DISTRIBUTIONS,
  MASS_COMPOSITION_OPTION_SOURCES,
  MASS_COMPOSITION_QUANTITY_MODES,
  MASS_COMPOSITION_UNCERTAINTY_MODES,
  MASS_UNITS,
  METHOD_COLUMN_PHASES,
  METHOD_QUANTITY_KINDS,
  METHOD_TABLE_COLUMN_ROLES,
  METHOD_TABLE_COLUMN_TYPES,
} from "@calibra-facil/shared";
import { CALIBRATION_PHASE_MODES } from "@calibra-facil/shared/calibration-record";
import { z } from "zod";
import {
  METHOD_ENGINE_PACKAGE_NAME,
  type CompiledMethod,
  type MethodPreviewScenario,
} from "./types";

const SafeKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/);

const NumericValueSchema = z.union([z.string().trim().min(1), z.number()]);

const SafeMetadataValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const SafeMetadataSchema = z
  .record(z.string(), SafeMetadataValueSchema)
  .default({});

const BaseInputSchema = z.object({
  key: SafeKeySchema,
  label: z.string().trim().min(1),
  unit: z.string().trim().optional(),
  required: z.boolean().default(false),
  metadata: SafeMetadataSchema.optional(),
});

const ScalarInputSchema = BaseInputSchema.extend({
  kind: z.literal("scalar"),
  quantityKind: z.enum(METHOD_QUANTITY_KINDS).optional(),
  defaultValue: NumericValueSchema.optional(),
  constraints: z
    .object({
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      integer: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

const RepeatedObservationInputSchema = BaseInputSchema.extend({
  kind: z.literal("repeated_observation"),
  minCount: z.number().int().min(1),
  maxCount: z.number().int().min(1).optional(),
  typeA: z
    .object({
      enabled: z.boolean(),
      minDegreesOfFreedom: z.number().finite().positive().optional(),
    })
    .strict()
    .optional(),
})
  .strict()
  .refine((input) => !input.maxCount || input.maxCount >= input.minCount, {
    message: "maxCount must be greater than or equal to minCount",
    path: ["maxCount"],
  });

const TableColumnSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    type: z.enum(METHOD_TABLE_COLUMN_TYPES),
    unit: z.string().trim().optional(),
    role: z.enum(METHOD_TABLE_COLUMN_ROLES).optional(),
    quantityKind: z.enum(METHOD_QUANTITY_KINDS).optional(),
    phase: z.enum(METHOD_COLUMN_PHASES).optional(),
    /** Presentation: false keeps a calc-input column out of the certificate grid. */
    includeInCertificate: z.boolean().optional(),
    massComposition: z
      .object({
        targetUnit: z.enum(MASS_UNITS).optional(),
        optionSource: z.enum(MASS_COMPOSITION_OPTION_SOURCES).optional(),
        targetColumns: z
          .object({
            certifiedValue: SafeKeySchema.optional(),
            compositionLabel: SafeKeySchema.optional(),
            expandedUncertainty: SafeKeySchema.optional(),
            maxError: SafeKeySchema.optional(),
            drift: SafeKeySchema.optional(),
            buoyancy: SafeKeySchema.optional(),
          })
          .strict()
          .optional(),
        uncertaintyMode: z.enum(MASS_COMPOSITION_UNCERTAINTY_MODES).optional(),
        quantityMode: z.enum(MASS_COMPOSITION_QUANTITY_MODES).optional(),
      })
      .strict()
      .optional(),
    standardValue: z
      .object({
        matchBy: z.enum(["nominal"]).optional(),
        targetColumns: z
          .object({
            value: SafeKeySchema.optional(),
            expandedUncertainty: SafeKeySchema.optional(),
            coverageFactor: SafeKeySchema.optional(),
            drift: SafeKeySchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    required: z.boolean().optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

const TableInputSchema = z
  .object({
    kind: z.literal("table"),
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    minRows: z.number().int().min(0).optional(),
    maxRows: z.number().int().min(1).optional(),
    columns: z.array(TableColumnSchema).min(1),
    required: z.boolean().optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict()
  .refine((input) => !input.maxRows || (input.minRows ?? 0) <= input.maxRows, {
    message: "maxRows must be greater than or equal to minRows",
    path: ["maxRows"],
  });

const SelectInputSchema = BaseInputSchema.extend({
  kind: z.literal("select"),
  options: z.array(z.string().trim().min(1)).min(1),
  defaultValue: z.string().trim().optional(),
}).strict();

const BooleanInputSchema = BaseInputSchema.extend({
  kind: z.literal("boolean"),
  defaultValue: z.boolean().optional(),
}).strict();

const TextInputSchema = BaseInputSchema.extend({
  kind: z.literal("text"),
  defaultValue: z.string().optional(),
}).strict();

const MethodInputSchema = z.discriminatedUnion("kind", [
  ScalarInputSchema,
  RepeatedObservationInputSchema,
  TableInputSchema,
  SelectInputSchema,
  BooleanInputSchema,
  TextInputSchema,
]);

const FormulaScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scalar") }).strict(),
  z
    .object({
      kind: z.literal("table_row"),
      tableKey: SafeKeySchema,
    })
    .strict(),
]);

const QuantitySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), key: SafeKeySchema }).strict(),
  z.object({ kind: z.literal("formula"), key: SafeKeySchema }).strict(),
  z
    .object({
      kind: z.literal("table_column"),
      tableKey: SafeKeySchema,
      columnKey: SafeKeySchema,
    })
    .strict(),
  z.object({ kind: z.literal("constant"), value: NumericValueSchema }).strict(),
]);

const MethodFormulaSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    expression: z.string().trim().min(1),
    scope: FormulaScopeSchema.optional(),
    outputUnit: z.string().trim().optional(),
    outputKind: z
      .enum([
        "correction",
        "error",
        "derived_quantity",
        "display",
        "intermediate",
      ])
      .optional(),
    required: z.boolean().default(true),
    dependencies: z.array(SafeKeySchema).optional(),
    reporting: z
      .object({
        includeInCertificate: z.boolean().optional(),
        role: z.enum(FORMULA_REPORTING_ROLES).optional(),
        group: z.enum(FORMULA_REPORTING_GROUPS).optional(),
        /**
         * Presentation phase for table_row outputs: lets the certificate
         * grid split "como recebido" / "após ajuste" tables (a *_antes/_apos
         * outputKey suffix carries no structural meaning).
         */
        phase: z.enum(["before", "after"]).optional(),
      })
      .strict()
      .optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

const TypeAUncertaintySchema = z
  .object({
    kind: z.literal("type_a"),
    observationsInputKey: SafeKeySchema.optional(),
    observations: z.array(QuantitySourceSchema).min(2).optional(),
    minDegreesOfFreedom: z.number().finite().positive().optional(),
  })
  .strict();

const TypeBUncertaintySchema = z
  .object({
    kind: z.literal("type_b"),
    distribution: z.enum(GUM_TYPE_B_DISTRIBUTIONS),
    standardUncertainty: NumericValueSchema.optional(),
    halfWidth: NumericValueSchema.optional(),
    limits: z
      .object({ lower: NumericValueSchema, upper: NumericValueSchema })
      .strict()
      .optional(),
    divisor: NumericValueSchema.optional(),
    coverageFactor: NumericValueSchema.optional(),
    expandedUncertainty: NumericValueSchema.optional(),
    degreesOfFreedom: z.number().finite().positive().optional(),
  })
  .strict();

const DirectStandardUncertaintySchema = z
  .object({
    kind: z.literal("direct_standard_uncertainty"),
    standardUncertainty: NumericValueSchema,
    degreesOfFreedom: z
      .union([z.number().finite().positive(), z.literal("Infinity")])
      .optional(),
  })
  .strict();

const MethodQuantitySchema = z
  .object({
    symbol: SafeKeySchema,
    source: QuantitySourceSchema,
    unit: z.string().trim().optional(),
    uncertainty: z.discriminatedUnion("kind", [
      TypeAUncertaintySchema,
      TypeBUncertaintySchema,
      DirectStandardUncertaintySchema,
    ]),
    degreesOfFreedom: z
      .union([z.number().finite().positive(), z.literal("Infinity")])
      .optional(),
    sensitivity: NumericValueSchema.optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

const MethodMeasurementModelSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    scope: FormulaScopeSchema.optional(),
    measurand: SafeKeySchema,
    expression: z.string().trim().min(1),
    quantities: z.array(MethodQuantitySchema).min(1),
    correlations: z
      .array(
        z
          .object({
            symbols: z.tuple([SafeKeySchema, SafeKeySchema]),
            coefficient: NumericValueSchema,
          })
          .strict(),
      )
      .optional(),
    covariances: z
      .array(
        z
          .object({
            symbols: z.tuple([SafeKeySchema, SafeKeySchema]),
            covariance: NumericValueSchema,
          })
          .strict(),
      )
      .optional(),
    coverageProbability: z.number().finite().gt(0).lt(1).optional(),
    coverageFactor: NumericValueSchema.optional(),
    outputUnit: z.string().trim().optional(),
    options: z
      .object({
        allowNonSmoothWithExplicitSensitivities: z.boolean().optional(),
        correlatedDegreesOfFreedom: z
          .enum(["generalized", "diagonal"])
          .optional(),
      })
      .strict()
      .optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

const MethodAcceptanceCriterionSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    expression: z.string().trim().min(1),
    severity: z.enum(ACCEPTANCE_CRITERION_SEVERITIES),
    message: z.string().trim().min(1),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

const CalibrationPhaseSnapshotSchema = z
  .object({
    blocks: z.record(
      z.string(),
      z
        .object({
          mode: z.enum(CALIBRATION_PHASE_MODES),
          reason: z.string().trim().optional().nullable(),
        })
        .strict(),
    ),
    recordedAt: z.string().optional(),
    recordedBy: z.string().optional(),
  })
  .strict();

const MethodPreviewScenarioSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    inputs: z.record(z.string(), z.unknown()),
    calibrationPhases: CalibrationPhaseSnapshotSchema.optional(),
    expected: z
      .object({
        formulas: z
          .record(
            z.string(),
            z.union([NumericValueSchema, z.array(NumericValueSchema)]),
          )
          .optional(),
        measurementModels: z
          .record(
            z.string(),
            z
              .object({
                estimate: z
                  .union([NumericValueSchema, z.array(NumericValueSchema)])
                  .optional(),
                standardUncertainty: z
                  .union([NumericValueSchema, z.array(NumericValueSchema)])
                  .optional(),
                expandedUncertainty: z
                  .union([NumericValueSchema, z.array(NumericValueSchema)])
                  .optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    expectFailure: z.boolean().optional(),
  })
  .strict();

export const MethodDraftSchema = z
  .object({
    id: SafeKeySchema,
    version: z.number().int().min(1),
    status: z.enum([
      "draft",
      "ready_for_review",
      "under_review",
      "published",
      "superseded",
      "deprecated",
      "archived",
    ]),
    name: z.string().trim().min(2),
    description: z.string().trim().optional(),
    assetTypeId: z.string().trim().optional(),
    discipline: z.string().trim().optional(),
    inputs: z.array(MethodInputSchema).default([]),
    formulas: z.array(MethodFormulaSchema).default([]),
    measurementModels: z.array(MethodMeasurementModelSchema).default([]),
    acceptanceCriteria: z.array(MethodAcceptanceCriterionSchema).default([]),
    previewScenarios: z.array(MethodPreviewScenarioSchema).default([]),
    metadata: SafeMetadataSchema.default({}),
  })
  .strict();

const MethodDiagnosticSchema = z
  .object({
    code: z.string(),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string(),
    path: z.string().optional(),
    details: z.record(z.string(), SafeMetadataValueSchema).optional(),
  })
  .strict();

const CompiledFormulaSchema = MethodFormulaSchema.omit({
  required: true,
  dependencies: true,
})
  .extend({
    normalizedFormula: z.string(),
    formulaFingerprint: z.string(),
    variables: z.array(z.string()),
  })
  .strip();

const CompiledMeasurementModelSchema = MethodMeasurementModelSchema.omit({
  label: true,
  measurand: true,
  outputUnit: true,
})
  .extend({
    formulaKey: SafeKeySchema.optional(),
    normalizedFormula: z.string(),
    modelFingerprint: z.string(),
  })
  .strip();

const NormalizedAcceptanceCriterionSchema =
  MethodAcceptanceCriterionSchema.extend({
    normalizedFormula: z.string(),
    variables: z.array(z.string()),
    criterionFingerprint: z.string(),
  }).strip();

/**
 * The compiled method a job freezes (`methodSnapshot.compiledMethod`) and the
 * desktop pushes back: what the executor reads, proved field by field, with the
 * same sub-schemas the draft is validated with. The top level tolerates keys a
 * later compiler adds; the parts the engine reads do not.
 */
const CompiledMethodSchema = z
  .object({
    methodId: z.string(),
    methodVersion: z.number(),
    status: z.literal("compiled"),
    engine: z
      .object({
        packageName: z.literal(METHOD_ENGINE_PACKAGE_NAME),
        version: z.string(),
        optionsFingerprint: z.string(),
      })
      .strip(),
    coreVersion: z.string(),
    normalizedMethodJson: z.string(),
    methodFingerprint: z.string(),
    inputs: z.array(MethodInputSchema),
    formulas: z.array(CompiledFormulaSchema),
    measurementModels: z.array(CompiledMeasurementModelSchema),
    acceptanceCriteria: z.array(NormalizedAcceptanceCriterionSchema),
    diagnostics: z.array(MethodDiagnosticSchema),
  })
  .strip();

/** The compiled method a stored or pushed value really is, or null. */
export function parseCompiledMethod(value: unknown): CompiledMethod | null {
  const parsed = CompiledMethodSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The preview scenario a stored value really is, or null (evidence read back from a method row). */
export function parseMethodPreviewScenario(
  value: unknown,
): MethodPreviewScenario | null {
  const parsed = MethodPreviewScenarioSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
