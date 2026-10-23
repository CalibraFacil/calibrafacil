/**
 * The tables the desktop mirrors, and the entity type each one is known by on the
 * sync wire (docs/architecture/sync-change-seq.md). One list for the three places
 * that must agree: the triggers that fill `sync_change_log` (migration 0121 and
 * sql/schema-extras.sql), the pull that reads it, and the bootstrap that walks the
 * same entities. `sync-change-log-sql.test.ts` fails when a trigger and this list
 * differ; the API's pull spec fails when its entity sources and this list differ.
 *
 * `reference_standard_certificate_document` is not an entity of its own: a change of a
 * standard's current certificate document is a change of the standard the desktop shows.
 */
export const SYNC_CHANGE_LOG_TABLES = [
  { table: "asset_type", entityType: "asset_type" },
  { table: "customer", entityType: "customer" },
  { table: "asset", entityType: "asset" },
  { table: "service", entityType: "service" },
  { table: "reference_standard", entityType: "reference_standard" },
  {
    table: "reference_standard_certificate_document",
    entityType: "reference_standard",
  },
  { table: "environmental_limits", entityType: "environmental_limit" },
  { table: "calibration_job", entityType: "calibration_job" },
  { table: "service_order", entityType: "service_order" },
  { table: "calibration_method", entityType: "published_method" },
  {
    table: "mass_composition_profile",
    entityType: "mass_composition_profile",
  },
] as const;

export type SyncChangeEntityType =
  (typeof SYNC_CHANGE_LOG_TABLES)[number]["entityType"];

/** Entity types in the order the bootstrap walks them and the desktop applies them. */
export const SYNC_CHANGE_ENTITY_ORDER = [
  "asset_type",
  "customer",
  "asset",
  "service",
  "reference_standard",
  "environmental_limit",
  "calibration_job",
  "service_order",
  "published_method",
  "mass_composition_profile",
] as const satisfies readonly SyncChangeEntityType[];
