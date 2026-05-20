import { createHash } from "node:crypto";

import { z } from "zod";

import type { WorkbookWarning } from "./types.js";

const CERTIFICATE_XLSX_FIELD_ROOTS = [
  "approval",
  "asset",
  "assetSnapshot",
  "calibrationLocationSnapshot",
  "calibrationPhase",
  "calibrationPhaseSnapshot",
  "calibrationResults",
  "certificate",
  "certificateTemplateSnapshot",
  "certifiedValues",
  "customer",
  "data",
  "dataDisplay",
  "environment",
  "environmentalSnapshot",
  "graphics",
  "job",
  "lab",
  "massCompositions",
  "method",
  "methodSnapshot",
  "organization",
  "raw",
  "resultRows",
  "results",
  "resultsDisplay",
  "serviceOrder",
  "snapshots",
  "standards",
  "standardsSnapshot",
  "traceability",
  "uncertainty",
  "uncertaintyBudget",
] as const;
const DANGEROUS_FIELD_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export const scalarCellBindingSchema = z
  .object({
    id: z.string().min(1),
    sheet: z.string().min(1),
    cell: z.string().min(1),
    fieldPath: z.string().min(1),
    formatter: z.string().optional(),
    required: z.boolean().optional(),
    governed: z.boolean().optional(),
  })
  .strict();

export const imageBindingSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("image"),
    sheet: z.string().min(1),
    targetRange: z.string().min(1),
    imageKind: z.enum([
      "qr_code",
      "signature",
      "organization_logo",
      "accreditation_seal",
      "eccentricity_indicator",
    ]),
    sourcePath: z.string().min(1),
    placeholderName: z.string().optional(),
  })
  .strict();

export const tableBindingSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("table"),
    arrayPath: z.string().min(1),
    sheet: z.string().min(1),
    templateRange: z.string().min(1),
    itemAlias: z.string().min(1),
    columns: z.array(
      z
        .object({
          cell: z.string().min(1),
          path: z.string().min(1),
          formatter: z.string().optional(),
        })
        .strict(),
    ),
    overflowPolicy: z.enum(["appendRows", "fixedSlots", "annex"]),
  })
  .strict();

export const certificateXlsxBindingManifestSchema = z
  .object({
    schemaVersion: z.literal("calibrafacil.certificateXlsxBinding.v1"),
    requiredFields: z.array(z.string().min(1)),
    governedFields: z.array(z.string().min(1)),
    scalarBindings: z.array(scalarCellBindingSchema),
    imageBindings: z.array(imageBindingSchema),
    tableBindings: z.array(tableBindingSchema),
    renderPolicy: z
      .object({
        formulas: z.enum(["preserve", "rejectVolatile"]),
        macros: z.literal("reject"),
        externalLinks: z.literal("reject"),
        converter: z.literal("gotenberg-libreoffice"),
      })
      .strict(),
  })
  .strict();

export type CertificateXlsxBindingManifest = z.infer<
  typeof certificateXlsxBindingManifestSchema
>;

export type CertificateXlsxManifestFieldWarning = WorkbookWarning & {
  code: "unknown_field_path";
};

export function validateCertificateXlsxBindingManifest(
  manifest: unknown,
): CertificateXlsxBindingManifest {
  return certificateXlsxBindingManifestSchema.parse(manifest);
}

export function getCertificateXlsxManifestFieldWarnings(
  manifest: CertificateXlsxBindingManifest,
): CertificateXlsxManifestFieldWarning[] {
  const warnings: CertificateXlsxManifestFieldWarning[] = [];
  const knownRoots = new Set<string>(CERTIFICATE_XLSX_FIELD_ROOTS);

  for (const fieldPath of manifest.requiredFields) {
    pushFieldPathWarning(warnings, "requiredFields", fieldPath, knownRoots);
  }

  for (const fieldPath of manifest.governedFields) {
    pushFieldPathWarning(warnings, "governedFields", fieldPath, knownRoots);
  }

  for (const binding of manifest.scalarBindings) {
    pushFieldPathWarning(
      warnings,
      `scalarBindings.${binding.id}`,
      binding.fieldPath,
      knownRoots,
      binding.sheet,
      binding.cell,
    );
  }

  for (const binding of manifest.imageBindings) {
    pushFieldPathWarning(
      warnings,
      `imageBindings.${binding.id}`,
      binding.sourcePath,
      knownRoots,
      binding.sheet,
    );
  }

  for (const binding of manifest.tableBindings) {
    pushFieldPathWarning(
      warnings,
      `tableBindings.${binding.id}`,
      binding.arrayPath,
      knownRoots,
      binding.sheet,
    );

    for (const column of binding.columns) {
      pushRelativeFieldPathWarning(
        warnings,
        `tableBindings.${binding.id}.${column.cell}`,
        column.path,
        binding.sheet,
        column.cell,
      );
    }
  }

  return warnings;
}

export function hashCertificateXlsxBindingManifest(
  manifest: CertificateXlsxBindingManifest,
): string {
  const canonical = canonicalJson(
    validateCertificateXlsxBindingManifest(manifest),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJson(entryValue)]),
    );
  }

  return value;
}

function pushFieldPathWarning(
  warnings: CertificateXlsxManifestFieldWarning[],
  bindingId: string,
  fieldPath: string,
  knownRoots: Set<string>,
  sheet?: string,
  cell?: string,
) {
  const segments = splitFieldPath(fieldPath);
  const root = segments[0];

  if (!root || hasDangerousSegment(segments) || !knownRoots.has(root)) {
    warnings.push({
      code: "unknown_field_path",
      message: `Binding "${bindingId}" references unsupported field path "${fieldPath}".`,
      sheet,
      cell,
      fieldPath,
    });
  }
}

function pushRelativeFieldPathWarning(
  warnings: CertificateXlsxManifestFieldWarning[],
  bindingId: string,
  fieldPath: string,
  sheet?: string,
  cell?: string,
) {
  const segments = splitFieldPath(fieldPath);

  if (segments.length === 0 || hasDangerousSegment(segments)) {
    warnings.push({
      code: "unknown_field_path",
      message: `Binding "${bindingId}" references unsupported field path "${fieldPath}".`,
      sheet,
      cell,
      fieldPath,
    });
  }
}

function splitFieldPath(fieldPath: string): string[] {
  return fieldPath
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function hasDangerousSegment(segments: string[]): boolean {
  return segments.some((segment) => DANGEROUS_FIELD_SEGMENTS.has(segment));
}
