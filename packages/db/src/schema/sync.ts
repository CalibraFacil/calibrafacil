// Tables of the "sync" area. Part of the schema entry packages/db/src/schema.ts.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  serial,
  jsonb,
  integer,
  bigint,
  bigserial,
  customType,
  check,
} from "drizzle-orm/pg-core";
import { organization } from "./identity";

// Desktop sync ops the cloud has claimed or applied. One row per (organization,
// op id): the unique index is what makes two concurrent pushes of the same op
// resolve to a single apply — the second insert conflicts and the op is
// reported as already applied (or still in progress). `appliedAt` is NULL while
// the op is claimed and being applied; `claimedAt` lets a claim whose process
// died be taken over after a lease. `result` keeps what the push answered
// (remote entity id/snapshot) so a retry gets the same acknowledgement.
// Events applied before this table existed are still found through
// organization_event_log (details->>'eventId').
export const syncAppliedEvent = pgTable(
  "sync_applied_event",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    claimedAt: timestamp("claimed_at").defaultNow().notNull(),
    appliedAt: timestamp("applied_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    // The version of the aggregate (entity_type + entity_id) this event produced:
    // 1 for the first desktop event applied to it, then 2, 3... The aggregate's
    // current version is the largest one; a pushed event that expects another one
    // is refused as a conflict. NULL on rows applied before it existed.
    aggregateVersion: integer("aggregate_version"),
  },
  (table) => [
    uniqueIndex("sync_applied_event_org_event_uidx").on(
      table.organizationId,
      table.eventId,
    ),
    index("sync_applied_event_aggregate_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
    ),
  ],
);

/**
 * Postgres `xid8`: a 64-bit transaction id that never wraps. Carried as its
 * decimal string (postgres-js hands unknown types back as text; JS numbers lose
 * precision past 2^53).
 */
const xid8 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "xid8";
  },
});

// The change log the desktop pull reads (protocol 3, migration 0122,
// docs/architecture/sync-change-seq.md). Triggers on the tables the desktop mirrors
// (sql/schema-extras.sql, `calibra_sync_change_log`) append one row per change, in
// the writer's own transaction. `xid` is that transaction's id: the pull serves only
// rows whose `xid` is below the oldest transaction still in flight, ordered by
// `(xid, seq)`, so a row can never appear behind the cursor after it was handed out.
//
// Soft references by design: `entity_id` outlives the row it names (a hard delete is
// an entry of its own), so there is no foreign key to the entity and no composite
// tenant key; `organization_id` is the tenant, CASCADE because the log is derived
// operational data, not evidence (records-retention.md). `unit_id` is the unit the
// entry is visible in (NULL = the whole laboratory); a row that moves between units
// writes an entry for each. An `asset_type` change (a global catalog) is written once
// per laboratory.
export const syncChangeLog = pgTable(
  "sync_change_log",
  {
    seq: bigserial("seq", { mode: "bigint" }).primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    op: text("op").$type<"upsert" | "delete">().notNull(),
    unitId: integer("unit_id"),
    xid: xid8("xid")
      .notNull()
      .default(sql`pg_current_xact_id()`),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
  },
  (table) => [
    index("sync_change_log_org_xid_seq_idx").on(
      table.organizationId,
      table.xid,
      table.seq,
    ),
    index("sync_change_log_changed_at_idx").on(table.changedAt),
    check("sync_change_log_op_check", sql`${table.op} in ('upsert', 'delete')`),
  ],
);

// The newest position the retention purge removed, per laboratory. A desktop whose
// cursor sorts below it may have missed entries and is told to bootstrap again.
export const syncChangeLogPurge = pgTable("sync_change_log_purge", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  purgedThroughXid: xid8("purged_through_xid").notNull(),
  purgedThroughSeq: bigint("purged_through_seq", {
    mode: "bigint",
  }).notNull(),
  purgedAt: timestamp("purged_at").defaultNow().notNull(),
});
