// Structural shape of an asset-type blueprint field. Mirrors `AssetTypeFieldDefinition`
// in `@calibra-facil/db`, re-declared here to keep `shared` free of a `db` dependency.
export type SpecFieldDefinition = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "weighing_ranges";
  options?: string[];
  unit?: string | null;
  required?: boolean;
};

export type DisplaySpec = { label: string; value: string };

/**
 * Pairs an asset-type blueprint `definition` with an instrument's `specifications`
 * value map and returns an ordered, printable `[{ label, value }]` list — only the
 * fields that actually have a value, in definition order.
 *
 * This is what lets the printed service order render instrument specs generically for
 * any asset type (a manômetro shows its pressure range, a balança shows capacity /
 * resolution, etc.) instead of hardcoded weighing rows.
 *
 * `weighing_ranges` fields are intentionally skipped: they are detailed calibration
 * data carried on the certificate, not intake identity for the service order.
 */
export function formatSpecificationsForDisplay(
  definition: SpecFieldDefinition[] | null | undefined,
  specifications: Record<string, unknown> | null | undefined,
): DisplaySpec[] {
  if (!Array.isArray(definition) || !specifications) return [];

  const specs: DisplaySpec[] = [];
  for (const field of definition) {
    if (field.type === "weighing_ranges") continue;

    const raw = specifications[field.key];
    if (raw === null || raw === undefined || raw === "") continue;

    const base = String(raw);
    const value =
      field.type === "number" && field.unit ? `${base} ${field.unit}` : base;
    specs.push({ label: field.label, value });
  }
  return specs;
}
