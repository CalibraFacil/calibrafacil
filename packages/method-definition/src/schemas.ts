import { z } from "zod";

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

export const SafeMetadataSchema = z
  .record(z.string(), SafeMetadataValueSchema)
  .default({});

const BaseInputSchema = z.object({
  key: SafeKeySchema,
  label: z.string().trim().min(1),
  unit: z.string().trim().optional(),
  required: z.boolean().default(false),
  metadata: SafeMetadataSchema.optional(),
});

export const ScalarInputSchema = BaseInputSchema.extend({
  kind: z.literal("scalar"),
  quantityKind: z
    .enum(["indication", "reference", "environment", "correction", "other"])
    .optional(),
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

export const RepeatedObservationInputSchema = BaseInputSchema.extend({
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

export const TableColumnSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    type: z.enum(["text", "number"]),
    unit: z.string().trim().optional(),
    role: z.enum(["standard_value", "mass_standard_composition"]).optional(),
    massComposition: z
      .object({
        targetUnit: z.enum(["mg", "g", "kg"]).optional(),
        optionSource: z
          .enum(["certified_values", "composition_profiles"])
          .optional(),
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
        uncertaintyMode: z.literal("expanded_rss").optional(),
        quantityMode: z.literal("linear_per_item_then_rss").optional(),
      })
      .strict()
      .optional(),
    required: z.boolean().optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

export const TableInputSchema = z
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

export const SelectInputSchema = BaseInputSchema.extend({
  kind: z.literal("select"),
  options: z.array(z.string().trim().min(1)).min(1),
  defaultValue: z.string().trim().optional(),
}).strict();

export const BooleanInputSchema = BaseInputSchema.extend({
  kind: z.literal("boolean"),
  defaultValue: z.boolean().optional(),
}).strict();

export const TextInputSchema = BaseInputSchema.extend({
  kind: z.literal("text"),
  defaultValue: z.string().optional(),
}).strict();

export const MethodInputSchema = z.discriminatedUnion("kind", [
  ScalarInputSchema,
  RepeatedObservationInputSchema,
  TableInputSchema,
  SelectInputSchema,
  BooleanInputSchema,
  TextInputSchema,
]);

export const MethodFormulaSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    expression: z.string().trim().min(1),
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
        role: z
          .enum([
            "primary_result",
            "expanded_uncertainty",
            "coverage_factor",
            "conformity_margin",
            "uncertainty_component",
            "auxiliary",
          ])
          .optional(),
        group: z
          .enum(["calibration_result", "uncertainty_budget", "raw_calculation"])
          .optional(),
      })
      .strict()
      .optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

const TypeAUncertaintySchema = z
  .object({
    kind: z.literal("type_a"),
    observationsInputKey: SafeKeySchema,
    minDegreesOfFreedom: z.number().finite().positive().optional(),
  })
  .strict();

const TypeBUncertaintySchema = z
  .object({
    kind: z.literal("type_b"),
    distribution: z.enum([
      "normal",
      "rectangular",
      "triangular",
      "u_shaped",
      "custom",
    ]),
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

export const MethodQuantitySchema = z
  .object({
    symbol: SafeKeySchema,
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("input"), key: SafeKeySchema }).strict(),
      z.object({ kind: z.literal("formula"), key: SafeKeySchema }).strict(),
      z
        .object({ kind: z.literal("constant"), value: NumericValueSchema })
        .strict(),
    ]),
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

export const MethodMeasurementModelSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
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
      })
      .strict()
      .optional(),
    metadata: SafeMetadataSchema.optional(),
  })
  .strict();

export const MethodAcceptanceCriterionSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    expression: z.string().trim().min(1),
    severity: z.enum(["info", "warning", "blocking"]),
    message: z.string().trim().min(1),
  })
  .strict();

export const MethodPreviewScenarioSchema = z
  .object({
    key: SafeKeySchema,
    label: z.string().trim().min(1),
    inputs: z.record(z.string(), z.unknown()),
    expected: z
      .object({
        formulas: z.record(z.string(), NumericValueSchema).optional(),
        measurementModels: z
          .record(
            z.string(),
            z
              .object({
                estimate: NumericValueSchema.optional(),
                standardUncertainty: NumericValueSchema.optional(),
                expandedUncertainty: NumericValueSchema.optional(),
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
