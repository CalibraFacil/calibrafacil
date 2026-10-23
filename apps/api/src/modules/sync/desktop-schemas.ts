import {
  CreateAssetSchema,
  UpdateServiceOrderExecutionSchema,
} from "@calibra-facil/schemas";

// ============================================================================
// Desktop payload tolerance
// ============================================================================
// Desktop outbox payloads are built by merging the FULL local SQLite row
// (packages/local-db), so optional fields arrive as explicit `null`, never as
// an absent key. The shared schemas declare those fields `.optional()`
// (absent-only) for the web/local-server boundary, which rejected every real
// desktop event here ("expected string, received null") — the push path only
// ever passed with hand-crafted null-free payloads. These variants accept
// `null` exactly where the local row can produce it; the apply handlers below
// already normalize null (`|| null`, `?? null`, `parseSyncDate`).
// Exported for spec coverage (sync.spec.ts) — not part of the route surface.
export const DesktopCreateAssetSchema = CreateAssetSchema.extend({
  manufacturer: CreateAssetSchema.shape.manufacturer.nullable(),
  model: CreateAssetSchema.shape.model.nullable(),
  comments: CreateAssetSchema.shape.comments.nullable(),
  lastCalibrationDate: CreateAssetSchema.shape.lastCalibrationDate.nullable(),
  installedAt: CreateAssetSchema.shape.installedAt.nullable(),
  specifications: CreateAssetSchema.shape.specifications.nullable(),
});

export const DesktopUpdateAssetSchema = DesktopCreateAssetSchema.partial().omit(
  {
    customerId: true,
    assetTypeId: true,
    baseMeasurementUnit: true,
  },
);

export const DesktopUpdateServiceOrderExecutionSchema =
  UpdateServiceOrderExecutionSchema.extend({
    result: UpdateServiceOrderExecutionSchema.shape.result.nullable(),
    items: UpdateServiceOrderExecutionSchema.shape.items.nullable(),
  });

// `CreateServiceOrderSchema` carries a superRefine, so it cannot be extended
// (Zod throws at runtime and `safeExtend` rejects the widened field types).
// For the two keys the local-db intake builder sends as `?? null`
// (`clientContactSnapshot`, `assetSnapshot`), drop an explicit null before the
// parse — for a CREATE, null and absent mean the same thing.
export const DESKTOP_SERVICE_ORDER_NULLABLE_KEYS = [
  "clientContactSnapshot",
  "assetSnapshot",
] as const;

export function stripDesktopNullEntries(
  payload: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const cleaned = { ...payload };
  for (const key of keys) {
    if (cleaned[key] === null) delete cleaned[key];
  }
  return cleaned;
}
