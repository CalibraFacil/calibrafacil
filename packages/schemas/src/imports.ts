import { z } from "zod";

/**
 * Backoffice migration-importer core (operations-console gap #12, preview-only).
 *
 * This is the entity/field contract + pure row validation used by the dry-run
 * preview. It intentionally does NOT write any domain records — the commit step
 * (resolving unit / customer / asset-type FKs and inserting real rows) is a
 * separate, gated follow-up. Keeping validation here makes it schema-first and
 * unit-testable, shared by the API endpoint and the operator UI.
 */

export const IMPORT_ENTITIES = ["assets"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportFieldDef = {
  key: string;
  label: string;
  required: boolean;
  /** Max length enforced during the dry-run. */
  maxLength: number;
  /** Values must be unique across the file (e.g. an asset tag). */
  unique?: boolean;
};

/**
 * Importable fields per entity. For `assets` these map cleanly onto the `asset`
 * table columns so the deferred commit step is a thin insert; the FK-bearing
 * columns (unit/customer/asset-type) are deliberately out of the preview scope.
 */
export const IMPORT_FIELDS: Record<ImportEntity, readonly ImportFieldDef[]> = {
  assets: [
    { key: "tag", label: "Tag / ID interno", required: true, maxLength: 120, unique: true },
    { key: "name", label: "Nome / descrição", required: true, maxLength: 200 },
    { key: "serialNumber", label: "Número de série", required: true, maxLength: 120 },
    { key: "manufacturer", label: "Fabricante", required: false, maxLength: 120 },
    { key: "model", label: "Modelo", required: false, maxLength: 120 },
  ],
};

export const MAX_IMPORT_ROWS = 5000;
/** Cap the inline error list so a bad file can't produce an unbounded payload. */
export const MAX_IMPORT_ERRORS = 200;
/** Number of clean rows echoed back as a sanity-check preview. */
export const IMPORT_PREVIEW_ROWS = 5;

export type ImportRowError = {
  /** 1-based row number as the operator sees it in their spreadsheet. */
  row: number;
  field: string;
  message: string;
};

export type ImportValidationResult = {
  entity: ImportEntity;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  /** True when `errors` was capped at MAX_IMPORT_ERRORS. */
  errorsTruncated: boolean;
  preview: Array<Record<string, string>>;
};

const ImportRowSchema = z.record(z.string(), z.string());

export const ImportValidateInputSchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  fileName: z.string().trim().max(300).optional(),
  /** target field key → source column header, kept for the audit record only. */
  mapping: z.record(z.string(), z.string()).optional(),
  rows: z.array(ImportRowSchema).max(MAX_IMPORT_ROWS),
});

export type ImportValidateInput = z.infer<typeof ImportValidateInputSchema>;

function normalizeCell(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Pure dry-run validation. Each row is checked for required fields, max length
 * and per-file uniqueness; a row with no errors is "valid". No side effects.
 */
export function validateImportRows(
  entity: ImportEntity,
  rows: Array<Record<string, string>>,
): ImportValidationResult {
  const fields = IMPORT_FIELDS[entity];
  const errors: ImportRowError[] = [];
  const preview: Array<Record<string, string>> = [];
  const seenUnique: Record<string, Map<string, number>> = {};
  for (const field of fields) {
    if (field.unique) seenUnique[field.key] = new Map();
  }

  let validRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const normalized: Record<string, string> = {};
    let rowHasError = false;

    const pushError = (field: string, message: string) => {
      rowHasError = true;
      if (errors.length < MAX_IMPORT_ERRORS) {
        errors.push({ row: rowNumber, field, message });
      }
    };

    for (const field of fields) {
      const value = normalizeCell(row[field.key]);
      normalized[field.key] = value;

      if (field.required && value === "") {
        pushError(field.key, `${field.label}: obrigatório`);
        continue;
      }
      if (value.length > field.maxLength) {
        pushError(
          field.key,
          `${field.label}: máximo de ${field.maxLength} caracteres`,
        );
      }
      if (field.unique && value !== "") {
        const seen = seenUnique[field.key];
        const key = value.toLowerCase();
        const firstSeenAt = seen?.get(key);
        if (firstSeenAt !== undefined) {
          pushError(
            field.key,
            `${field.label}: duplicado no arquivo (linha ${firstSeenAt})`,
          );
        } else {
          seen?.set(key, rowNumber);
        }
      }
    }

    if (rowHasError) return;
    validRows += 1;
    if (preview.length < IMPORT_PREVIEW_ROWS) preview.push(normalized);
  });

  return {
    entity,
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
    errors,
    errorsTruncated: rows.length - validRows > 0 && errors.length >= MAX_IMPORT_ERRORS,
    preview,
  };
}
