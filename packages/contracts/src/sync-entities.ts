/**
 * The one table of the entities the desktop mirrors (docs/architecture/sync-change-seq.md):
 * wire name, cloud table, local mirror table, id prefix, pull and bootstrap order, delete
 * mode, bootstrap array, skipped-row kind and partition domain table. `packages/db`,
 * `packages/contracts`, `apps/api` and `packages/local-db` derive from it; a side that
 * needs data only it knows (the API's row sources, the local mirror's column predicates)
 * keeps a `satisfies Record<SyncEntity, ...>` map, so a new entity fails to compile there
 * until that side says what it does with it.
 *
 * What stays outside, because it is not a TypeScript list: the SQL triggers that fill
 * `sync_change_log` (migration 0122 and `packages/db/sql/schema-extras.sql`). The drift
 * test `packages/db/src/sync-change-log-sql.test.ts` fails when a trigger and this
 * table differ, and `packages/local-db/src/sync-entities.test.ts` fails when a mirror
 * table or its id column is not what the table says.
 *
 * This file imports nothing (no Hono, no zod): it is on its own subpath
 * (`@calibra-facil/contracts/sync-entities`) so the db package and the desktop's local
 * database can read it without pulling the API's types.
 */

/**
 * The wire names, in the order the bootstrap walks the entities and the desktop applies
 * them (parents before the rows that point at them). It is also the pull's tie-break
 * rank and the page-token rank of the paged bootstrap: reordering it changes both.
 */
export const SYNC_ENTITY_ORDER = [
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
] as const;

export type SyncEntity = (typeof SYNC_ENTITY_ORDER)[number];

/**
 * How the desktop removes a mirrored row the cloud deleted, soft-deleted or moved out
 * of scope:
 * - `deleted_at`: the local table keeps the row with `deleted_at` set (every local
 *   query filters it, local history keeps pointing at it);
 * - `sync_state`: the row stays with `sync_state = 'deleted'` (reference standards,
 *   which have no `deleted_at`);
 * - `hard`: the row is deleted.
 */
export type SyncDeleteMode = "deleted_at" | "sync_state" | "hard";

export type SyncEntityDefinition = {
  /** The cloud table the entity is read from (and whose changes the triggers log). */
  readonly cloudTable: string;
  /**
   * Other cloud tables whose changes are changes of this entity (a standard's current
   * certificate document is a change of the standard the desktop shows).
   */
  readonly extraChangeLogTables?: readonly string[];
  /** The local SQLite table that mirrors it. */
  readonly mirrorTable: string;
  /**
   * The prefix of a mirrored row's local id: `<prefix>:<remote id>`. A row created on the
   * desktop keeps its own local id and only gains a `remote_id`.
   */
  readonly idPrefix: string;
  /** How a deleted row leaves the local mirror. */
  readonly deleteMode: SyncDeleteMode;
  /** The array of the bootstrap response (`syncBootstrapResponseSchema`) that carries its rows. */
  readonly bootstrapKey: string;
  /**
   * An aggregate that desktop users edit offline: a pulled row with queued local
   * changes is skipped and remembered (`sync_skipped_rows`), and its kind is the
   * `aggregate_kind` of its outbox events.
   */
  readonly skippedRowKind: boolean;
  /**
   * The local table holds customer or calibration data: a database that has rows in it
   * is never adopted by another account (`localDatabaseHasDomainRows`).
   */
  readonly partitionDomain: boolean;
};

export const SYNC_ENTITIES = {
  asset_type: {
    cloudTable: "asset_type",
    mirrorTable: "asset_types",
    idPrefix: "asset-type",
    deleteMode: "hard",
    bootstrapKey: "assetTypes",
    skippedRowKind: false,
    partitionDomain: false,
  },
  customer: {
    cloudTable: "customer",
    mirrorTable: "customers",
    idPrefix: "customer",
    deleteMode: "deleted_at",
    bootstrapKey: "customers",
    skippedRowKind: true,
    partitionDomain: true,
  },
  asset: {
    cloudTable: "asset",
    mirrorTable: "assets",
    idPrefix: "asset",
    deleteMode: "deleted_at",
    bootstrapKey: "assets",
    skippedRowKind: true,
    partitionDomain: true,
  },
  service: {
    cloudTable: "service",
    mirrorTable: "services",
    idPrefix: "service",
    deleteMode: "hard",
    bootstrapKey: "services",
    skippedRowKind: false,
    partitionDomain: false,
  },
  reference_standard: {
    cloudTable: "reference_standard",
    extraChangeLogTables: ["reference_standard_certificate_document"],
    mirrorTable: "reference_standards",
    idPrefix: "standard",
    deleteMode: "sync_state",
    bootstrapKey: "standards",
    skippedRowKind: false,
    partitionDomain: true,
  },
  environmental_limit: {
    cloudTable: "environmental_limits",
    mirrorTable: "environmental_limits",
    idPrefix: "environmental-limit",
    deleteMode: "hard",
    bootstrapKey: "environmentalLimits",
    skippedRowKind: false,
    partitionDomain: false,
  },
  calibration_job: {
    cloudTable: "calibration_job",
    mirrorTable: "calibration_jobs",
    idPrefix: "job",
    deleteMode: "deleted_at",
    bootstrapKey: "jobs",
    skippedRowKind: true,
    partitionDomain: true,
  },
  service_order: {
    cloudTable: "service_order",
    mirrorTable: "service_orders",
    idPrefix: "service-order",
    deleteMode: "hard",
    bootstrapKey: "serviceOrders",
    skippedRowKind: true,
    partitionDomain: true,
  },
  published_method: {
    cloudTable: "calibration_method",
    mirrorTable: "published_methods",
    idPrefix: "method",
    deleteMode: "hard",
    bootstrapKey: "publishedMethods",
    skippedRowKind: false,
    partitionDomain: false,
  },
  mass_composition_profile: {
    cloudTable: "mass_composition_profile",
    mirrorTable: "mass_composition_profiles",
    idPrefix: "mass_composition_profile",
    deleteMode: "hard",
    bootstrapKey: "massCompositionProfiles",
    skippedRowKind: false,
    partitionDomain: false,
  },
} as const satisfies Record<SyncEntity, SyncEntityDefinition>;

/** The array of the bootstrap response that carries an entity's rows. */
export type SyncBootstrapKey =
  (typeof SYNC_ENTITIES)[SyncEntity]["bootstrapKey"];

type EntitiesWhere<Flag extends "skippedRowKind" | "partitionDomain"> = {
  [Entity in SyncEntity]: (typeof SYNC_ENTITIES)[Entity][Flag] extends true
    ? Entity
    : never;
}[SyncEntity];

/** The entities whose pulled rows are skipped while local changes are queued. */
export type SyncSkippedRowKind = EntitiesWhere<"skippedRowKind">;

/** The entities whose local table is a partition domain table. */
export type SyncPartitionDomainEntity = EntitiesWhere<"partitionDomain">;

export function isSyncEntity(value: string): value is SyncEntity {
  return Object.hasOwn(SYNC_ENTITIES, value);
}

export function isSyncSkippedRowKind(
  value: string,
): value is SyncSkippedRowKind {
  return isSyncEntity(value) && SYNC_ENTITIES[value].skippedRowKind;
}

/** The entity types in sync order that satisfy `keep`, typed as the narrowed union. */
function entitiesWhere<Entity extends SyncEntity>(
  keep: (entity: SyncEntity) => entity is Entity,
): readonly Entity[] {
  return SYNC_ENTITY_ORDER.filter(keep);
}

export const SYNC_SKIPPED_ROW_KINDS = entitiesWhere(isSyncSkippedRowKind);

export const SYNC_PARTITION_DOMAIN_ENTITIES = entitiesWhere(
  (entity): entity is SyncPartitionDomainEntity =>
    SYNC_ENTITIES[entity].partitionDomain,
);

/** Every cloud table whose changes the triggers log, with the entity type each one logs as. */
export function syncChangeLogTables(): ReadonlyArray<{
  table: string;
  entityType: SyncEntity;
}> {
  return SYNC_ENTITY_ORDER.flatMap((entityType) => {
    const definition: SyncEntityDefinition = SYNC_ENTITIES[entityType];
    return [
      { table: definition.cloudTable, entityType },
      ...(definition.extraChangeLogTables ?? []).map((table) => ({
        table,
        entityType,
      })),
    ];
  });
}

/** The SQL predicate (on the local mirror table) for a row that is still live, which its delete mode decides. */
export function syncMirrorLiveCondition(entity: SyncEntity): string {
  switch (SYNC_ENTITIES[entity].deleteMode) {
    case "deleted_at":
      return "deleted_at IS NULL";
    case "sync_state":
      return "sync_state <> 'deleted'";
    case "hard":
      return "1 = 1";
  }
}

/** The local id of the mirror of a cloud row: `<prefix>:<remote id>`. */
export function syncMirrorLocalId(
  entity: SyncEntity,
  remoteId: number,
): string {
  return `${SYNC_ENTITIES[entity].idPrefix}:${remoteId}`;
}
