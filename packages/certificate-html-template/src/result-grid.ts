import { z } from "zod";

/**
 * Results data-grid derivation (reframe T22 — the credibility centerpiece).
 *
 * A calibration certificate's results table is a MULTI-POINT GRID whose
 * columns come from the METHOD (per-method defaults, 06-reframe §G #3):
 *   - table dataFields (`type: "table"`) contribute input columns
 *     (key/label/unit/phase as-found|as-left|always);
 *   - table_row formulas contribute computed columns (per-row arrays under
 *     the formula's outputKey in the frozen `results`), honoring
 *     `reporting.includeInCertificate`.
 * The TEMPLATE overrides via the block layout envelope (`hiddenColumns`).
 *
 * DOQ-CGCRE-057 shape: two-row header (label row + bracketed-unit row);
 * NIT-DICLA-021: tabular uncertainty carries NO `±` — we never emit one.
 */

const tableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string().optional(),
  unit: z.string().nullish(),
  phase: z.enum(["before", "after", "always"]).nullish(),
});

const tableFieldSchema = z.object({
  key: z.string(),
  label: z.string().nullish(),
  type: z.literal("table"),
  columns: z.array(tableColumnSchema).nullish(),
});

const tableRowFormulaSchema = z.object({
  outputKey: z.string(),
  label: z.string().nullish(),
  unit: z.string().nullish(),
  scope: z.object({ kind: z.literal("table_row"), tableKey: z.string() }),
  reporting: z
    .object({
      includeInCertificate: z.boolean().nullish(),
      role: z.string().nullish(),
    })
    .nullish(),
});

export type ResultGridColumn = {
  key: string;
  label: string;
  unit: string | null;
  kind: "input" | "computed";
  phase: "before" | "after" | "always";
  role: string | null;
};

export type ResultGrid = {
  tableKey: string;
  title: string | null;
  columns: ResultGridColumn[];
  /** row-major cell values, aligned with `columns`. */
  rows: (string | number | null)[][];
};

export type ResultGridLayout = {
  hiddenColumns?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const PHASE_ORDER: Record<string, number> = { always: 0, before: 1, after: 2 };

/**
 * Derive the multi-point grids from the frozen certificate input data
 * (`methodSnapshot` + `data` + `results` roots of buildXlsxCertificateData).
 * Returns [] when the method defines no table fields (scalar-only methods
 * fall back to the scalar results table).
 */
export function deriveResultGrids(
  inputData: Record<string, unknown>,
  layout: ResultGridLayout = {},
): ResultGrid[] {
  const methodSnapshot = Reflect.get(inputData, "methodSnapshot");
  if (!isRecord(methodSnapshot)) return [];
  const hidden = new Set(layout.hiddenColumns ?? []);

  const rawFields = Reflect.get(methodSnapshot, "dataFields");
  const rawFormulas = Reflect.get(methodSnapshot, "formulas");
  const data = Reflect.get(inputData, "data");
  const results = Reflect.get(inputData, "results");

  const tableFields = (Array.isArray(rawFields) ? rawFields : []).flatMap(
    (field) => {
      const parsed = tableFieldSchema.safeParse(field);
      return parsed.success ? [parsed.data] : [];
    },
  );
  const rowFormulas = (Array.isArray(rawFormulas) ? rawFormulas : []).flatMap(
    (formula) => {
      const parsed = tableRowFormulaSchema.safeParse(formula);
      return parsed.success ? [parsed.data] : [];
    },
  );

  const grids: ResultGrid[] = [];
  for (const field of tableFields) {
    const tableRows = isRecord(data) ? Reflect.get(data, field.key) : null;
    if (!Array.isArray(tableRows) || tableRows.length === 0) continue;

    const inputColumns: ResultGridColumn[] = (field.columns ?? [])
      .filter((column) => !hidden.has(column.key))
      .map((column) => ({
        key: column.key,
        label: column.label,
        unit: column.unit ?? null,
        kind: "input",
        phase: column.phase ?? "always",
        role: null,
      }));

    const computedColumns: ResultGridColumn[] = rowFormulas
      .filter(
        (formula) =>
          formula.scope.tableKey === field.key &&
          formula.reporting?.includeInCertificate !== false &&
          !hidden.has(formula.outputKey),
      )
      .map((formula) => ({
        key: formula.outputKey,
        label: formula.label ?? formula.outputKey,
        unit: formula.unit ?? null,
        kind: "computed",
        phase: "always",
        role: formula.reporting?.role ?? null,
      }));

    // Stable order: always-phase inputs, as-found inputs, as-left inputs,
    // then computed columns in method order.
    const columns = [
      ...inputColumns.sort(
        (left, right) =>
          (PHASE_ORDER[left.phase] ?? 0) - (PHASE_ORDER[right.phase] ?? 0),
      ),
      ...computedColumns,
    ];
    if (columns.length === 0) continue;

    const rows: (string | number | null)[][] = tableRows.map(
      (row, rowIndex) => {
        return columns.map((column) => {
          if (column.kind === "input") {
            const value = isRecord(row) ? Reflect.get(row, column.key) : null;
            return typeof value === "number" || typeof value === "string"
              ? value
              : null;
          }
          const series = isRecord(results)
            ? Reflect.get(results, column.key)
            : null;
          const value = Array.isArray(series) ? series[rowIndex] : null;
          return typeof value === "number" || typeof value === "string"
            ? value
            : null;
        });
      },
    );

    grids.push({
      tableKey: field.key,
      title: field.label ?? null,
      columns,
      rows,
    });
  }
  return grids;
}
