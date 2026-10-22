/**
 * Retention of regulated records (decision Q16 in docs/auditoria-perguntas.md):
 * technical records, certificates, audit logs and event logs are kept at least
 * 10 years, configurable per organization, never below 5 years
 * (`organization.retention_years`). Nothing is purged until an operator enables
 * it.
 *
 * This module is the single, schema-derived description of WHAT is evidence and
 * HOW the rest of the data model may reach it:
 *
 *   - `EVIDENCE_REGISTRY` names the evidence tables (the audit / event logs are
 *     recognised by their name);
 *   - `listForeignKeys()` reads every foreign key straight from `schema.ts`;
 *   - `findEvidenceDeleteViolations()` is the invariant the test suite enforces:
 *     no foreign key may CASCADE a delete into evidence unless it is a listed
 *     owned-part edge of an evidence aggregate;
 *   - `buildRetentionInventory()` feeds docs/architecture/records-retention.md
 *     (see scripts/records-retention-inventory.ts) so the document cannot drift;
 *   - `organizationFootprint()` / `organizationScopeSql()` describe the rows that
 *     belong to an organization, used by the purge job.
 *
 * It only reads drizzle metadata: it never touches a database.
 */
import { is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { TENANT_FK_SUFFIX } from "./tenancy";

export type ReferentialAction =
  | "cascade"
  | "restrict"
  | "no action"
  | "set null"
  | "set default";

export type EvidenceCategory =
  | "technical-record"
  | "certificate"
  | "audit-log"
  | "event-log"
  | "reference-standard"
  | "nc-capa"
  | "personnel"
  | "service-order"
  | "finance";

export const EVIDENCE_CATEGORIES = [
  "technical-record",
  "certificate",
  "audit-log",
  "event-log",
  "reference-standard",
  "nc-capa",
  "personnel",
  "service-order",
  "finance",
] as const satisfies readonly EvidenceCategory[];

export const EVIDENCE_CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  "technical-record": "Technical records (calibration, SPC, OOT)",
  certificate: "Certificates",
  "audit-log": "Audit logs",
  "event-log": "Event logs",
  "reference-standard": "Reference standards and their certificates",
  "nc-capa": "Non-conformities and corrective actions",
  personnel: "Personnel competence and authorization",
  "service-order": "Service orders, requests and visits",
  finance: "Finance documents and agreements",
};

/** Default and floor of `organization.retention_years` (decision Q16). */
export const DEFAULT_RETENTION_YEARS = 10;
export const MINIMUM_RETENTION_YEARS = 5;

/**
 * Evidence tables that are not audit/event logs. The audit and event logs are
 * recognised by name (`*_audit_log`, `*_event_log`, see `evidenceCategory`).
 */
export const EVIDENCE_REGISTRY: Readonly<Record<string, EvidenceCategory>> = {
  // technical records
  calibration_job: "technical-record",
  job_standard: "technical-record",
  check_standard_reading: "technical-record",
  control_chart: "technical-record",
  proficiency_test: "technical-record",
  pt_plan_item: "technical-record",
  asset_oot_event: "technical-record",
  asset_oot_impact_assessment: "technical-record",
  oot_impact_assessment: "technical-record",
  oot_notification: "technical-record",
  // certificates
  issued_certificate_snapshot: "certificate",
  certificate_release: "certificate",
  certificate_numbering_sequence: "certificate",
  // reference standards
  reference_standard: "reference-standard",
  reference_standard_certificate_document: "reference-standard",
  standard_recall: "reference-standard",
  // NC / CAPA
  non_conformance: "nc-capa",
  corrective_action: "nc-capa",
  // personnel (ISO/IEC 17025 §6.2)
  personnel_competence: "personnel",
  training_record: "personnel",
  authorized_signatory: "personnel",
  // service orders, requests, visits
  calibration_request: "service-order",
  calibration_request_item: "service-order",
  calibration_visit: "service-order",
  visit_reschedule_request: "service-order",
  service_order: "service-order",
  service_order_asset_snapshot: "service-order",
  service_order_attachment: "service-order",
  service_order_certificate_link: "service-order",
  service_order_delivery_document: "service-order",
  service_order_evaluation: "service-order",
  service_order_execution: "service-order",
  service_order_execution_item: "service-order",
  service_order_intake_document: "service-order",
  service_order_outsourced_cost: "service-order",
  service_order_quote: "service-order",
  service_order_quote_item: "service-order",
  service_order_numbering_sequence: "service-order",
  // finance
  billing_document: "finance",
  billing_document_item: "finance",
  receivable_installment: "finance",
  payment_receipt: "finance",
  billing_group: "finance",
  billing_group_service_order: "finance",
  commercial_agreement: "finance",
  job_commercial_snapshot: "finance",
};

export function evidenceCategory(table: string): EvidenceCategory | null {
  if (table.endsWith("_audit_log")) return "audit-log";
  if (table.endsWith("_event_log")) return "event-log";
  return EVIDENCE_REGISTRY[table] ?? null;
}

export function isEvidenceTable(table: string): boolean {
  return evidenceCategory(table) !== null;
}

/**
 * Owned-part edges: an evidence row that exists only as a part of another
 * evidence row keeps its ON DELETE CASCADE towards that owner. The owner's own
 * deletion is guarded (an APPROVED job is undeletable, its organization /
 * customer / asset / unit / standard FKs are RESTRICT), so the cascade can only
 * ever remove the parts of a record that is itself removable. Every other
 * cascade into evidence is a retention hole and must be RESTRICT.
 */
export type OwnedPartEdge = {
  table: string;
  column: string;
  parent: string;
  reason: string;
};

export const OWNED_PART_EDGES: readonly OwnedPartEdge[] = [
  {
    table: "asset_oot_impact_assessment",
    column: "event_id",
    parent: "asset_oot_event",
    reason: "the impact assessment is a part of its OOT event",
  },
  {
    table: "billing_document_item",
    column: "document_id",
    parent: "billing_document",
    reason: "a line is a part of its billing document",
  },
  {
    table: "receivable_installment",
    column: "document_id",
    parent: "billing_document",
    reason: "an installment is a part of its billing document",
  },
  {
    table: "payment_receipt",
    column: "installment_id",
    parent: "receivable_installment",
    reason: "a receipt is a part of its installment",
  },
  {
    table: "billing_group_service_order",
    column: "group_id",
    parent: "billing_group",
    reason: "membership rows are a part of their billing group",
  },
  {
    table: "calibration_request_item",
    column: "request_id",
    parent: "calibration_request",
    reason: "an item is a part of its request",
  },
  {
    table: "visit_reschedule_request",
    column: "visit_id",
    parent: "calibration_visit",
    reason: "a reschedule request is a part of its visit",
  },
  {
    table: "job_standard",
    column: "job_id",
    parent: "calibration_job",
    reason: "the standards-used list is a part of its job",
  },
  {
    table: "job_commercial_snapshot",
    column: "job_id",
    parent: "calibration_job",
    reason: "the commercial snapshot is a part of its job",
  },
  {
    table: "certificate_release",
    column: "calibration_job_id",
    parent: "calibration_job",
    reason: "the release record is a part of its job's certificate",
  },
  {
    table: "service_order_asset_snapshot",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_attachment",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_certificate_link",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_delivery_document",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_evaluation",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_execution",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_intake_document",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_outsourced_cost",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_quote",
    column: "service_order_id",
    parent: "service_order",
    reason: "a part of its service order",
  },
  {
    table: "service_order_execution_item",
    column: "execution_id",
    parent: "service_order_execution",
    reason: "an execution line is a part of its execution",
  },
  {
    table: "service_order_quote_item",
    column: "quote_id",
    parent: "service_order_quote",
    reason: "a quote line is a part of its quote",
  },
];

/**
 * Audit logs that point at the entity they document through a plain column with
 * NO foreign key (CMP-06 / CMP-07 soft references). Since migration 0118 each of
 * them also carries its own organization_id (tenancy.ts), which the purge job
 * uses; the entity pointer stays the way to reach the entity the row documents.
 */
export type SoftReference = { table: string; column: string; entity: string };

export const SOFT_REFERENCE_LOGS: readonly SoftReference[] = [
  { table: "asset_audit_log", column: "asset_id", entity: "asset" },
  {
    table: "asset_oot_audit_log",
    column: "event_id",
    entity: "asset_oot_event",
  },
  {
    table: "authorized_signatory_audit_log",
    column: "signatory_id",
    entity: "authorized_signatory",
  },
  {
    table: "calibration_request_audit_log",
    column: "request_id",
    entity: "calibration_request",
  },
  {
    table: "control_chart_audit_log",
    column: "control_chart_id",
    entity: "control_chart",
  },
  {
    table: "corrective_action_audit_log",
    column: "capa_id",
    entity: "corrective_action",
  },
  { table: "customer_audit_log", column: "customer_id", entity: "customer" },
  { table: "job_audit_log", column: "job_id", entity: "calibration_job" },
  {
    table: "method_audit_log",
    column: "method_id",
    entity: "calibration_method",
  },
  {
    table: "non_conformance_audit_log",
    column: "nc_id",
    entity: "non_conformance",
  },
  {
    table: "personnel_competence_audit_log",
    column: "competence_id",
    entity: "personnel_competence",
  },
  {
    table: "proficiency_test_audit_log",
    column: "proficiency_test_id",
    entity: "proficiency_test",
  },
  {
    table: "reference_standard_audit_log",
    column: "standard_id",
    entity: "reference_standard",
  },
  { table: "service_audit_log", column: "service_id", entity: "service" },
  {
    table: "training_record_audit_log",
    column: "training_record_id",
    entity: "training_record",
  },
  { table: "visit_audit_log", column: "visit_id", entity: "calibration_visit" },
];

/** Organization columns that name the LAB tenant that owns a row. */
const LAB_ORGANIZATION_COLUMNS = ["organization_id", "lab_organization_id"];

/**
 * Timestamp columns that date a record. The newest of them, over every
 * evidence row of an organization, starts that organization's retention clock.
 */
const RECORD_DATE_COLUMNS = [
  "created_at",
  "updated_at",
  "performed_at",
  "approved_at",
  "issued_at",
  "occurred_at",
  "uploaded_at",
  "finished_at",
  "completed_at",
  "paid_at",
  "released_at",
  "recorded_at",
  "voided_at",
  "added_at",
  "linked_at",
  "captured_at",
];

/**
 * Evidence that belongs to the platform, not to one organization: it has no
 * organization column and is never purged with an organization.
 */
export const PLATFORM_EVIDENCE_TABLES: readonly string[] = [
  "platform_event_log",
];

export type ForeignKeyEdge = {
  /** Referencing (child) table. */
  table: string;
  columns: readonly string[];
  /** Referenced (parent) table. */
  parent: string;
  parentColumns: readonly string[];
  onDelete: ReferentialAction;
  nullable: boolean;
};

export type TableInfo = {
  name: string;
  columns: readonly string[];
};

type TableMeta = TableInfo & {
  foreignKeys: readonly ForeignKeyEdge[];
};

function referentialAction(value: string | undefined): ReferentialAction {
  switch (value) {
    case "cascade":
    case "restrict":
    case "set null":
    case "set default":
    case "no action":
      return value;
    default:
      // Postgres' default when no action is written.
      return "no action";
  }
}

function readTables(): readonly TableMeta[] {
  const tables: TableMeta[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    // The composite (organization_id, parent_id) keys of migration 0118 repeat
    // the action of the single-column key next to them: they pair a child with
    // its parent's tenant (tenancy.ts), they are not another delete edge.
    const foreignKeys = config.foreignKeys
      .filter((foreignKey) => !foreignKey.getName().endsWith(TENANT_FK_SUFFIX))
      .map((foreignKey): ForeignKeyEdge => {
        const reference = foreignKey.reference();
        return {
          table: config.name,
          columns: reference.columns.map((column) => column.name),
          parent: getTableConfig(reference.foreignTable).name,
          parentColumns: reference.foreignColumns.map((column) => column.name),
          onDelete: referentialAction(foreignKey.onDelete),
          nullable: reference.columns.some((column) => !column.notNull),
        };
      });
    tables.push({
      name: config.name,
      columns: config.columns.map((column) => column.name),
      foreignKeys,
    });
  }
  return sortedCopy(tables, (a, b) => a.name.localeCompare(b.name));
}

const TABLES = readTables();
const TABLES_BY_NAME = new Map(TABLES.map((table) => [table.name, table]));

export function listTables(): readonly TableInfo[] {
  return TABLES;
}

export function listForeignKeys(): readonly ForeignKeyEdge[] {
  return TABLES.flatMap((table) => table.foreignKeys);
}

export function listEvidenceTables(): readonly string[] {
  return TABLES.filter((table) => isEvidenceTable(table.name)).map(
    (table) => table.name,
  );
}

function isOwnedPart(edge: ForeignKeyEdge): boolean {
  return OWNED_PART_EDGES.some(
    (owned) =>
      owned.table === edge.table &&
      owned.parent === edge.parent &&
      edge.columns.length === 1 &&
      edge.columns[0] === owned.column,
  );
}

/**
 * Foreign keys that would CASCADE a delete into evidence although they are not
 * owned-part edges. Must be empty (enforced by records-retention.test.ts, and by
 * migration 0117 on existing databases).
 */
export function findEvidenceDeleteViolations(): readonly ForeignKeyEdge[] {
  return listForeignKeys().filter(
    (edge) =>
      edge.onDelete === "cascade" &&
      isEvidenceTable(edge.table) &&
      !isOwnedPart(edge),
  );
}

/** Owned-part edges that are declared but absent from, or not CASCADE in, schema.ts. */
export function findStaleOwnedPartEdges(): readonly OwnedPartEdge[] {
  const edges = listForeignKeys();
  return OWNED_PART_EDGES.filter(
    (owned) =>
      !edges.some(
        (edge) =>
          edge.table === owned.table &&
          edge.parent === owned.parent &&
          edge.onDelete === "cascade" &&
          edge.columns.length === 1 &&
          edge.columns[0] === owned.column,
      ),
  );
}

// ---------------------------------------------------------------------------
// Inventory (docs/architecture/records-retention.md)
// ---------------------------------------------------------------------------

/** Roots whose deletion the inventory follows. */
export const RETENTION_ROOTS = [
  "organization",
  "customer",
  "asset",
  "user",
] as const;

export type RetentionRoot = (typeof RETENTION_ROOTS)[number];

export type PathStep = { edge: ForeignKeyEdge };

/** How deleting a root reaches one evidence table. */
export type EvidenceImpact = {
  evidence: string;
  /** Cascade chain from the root to the table that references the evidence. */
  chain: readonly ForeignKeyEdge[];
  /** The final edge into the evidence table. */
  edge: ForeignKeyEdge;
  effect: "deletes" | "blocks" | "nulls";
};

function sortedCopy<T>(
  items: Iterable<T>,
  compare?: (a: T, b: T) => number,
): T[] {
  const copy = [...items];
  copy.sort(compare);
  return copy;
}

function describeEdge(edge: ForeignKeyEdge): string {
  return `${edge.table}.${edge.columns.join("+")}`;
}

export function edgeLabel(edge: ForeignKeyEdge): string {
  return describeEdge(edge);
}

/**
 * Every FK path by which deleting `root` could delete, null or be blocked by an
 * evidence table. A path is a chain of CASCADE edges starting at the root (the
 * tables Postgres deletes along with it) followed by one final edge into an
 * evidence table: `cascade` there would delete the evidence, `set null` nulls a
 * column of it, `restrict` / `no action` makes Postgres refuse the whole delete.
 */
export function evidenceImpactOf(
  root: RetentionRoot,
): readonly EvidenceImpact[] {
  const edges = listForeignKeys();
  const byParent = new Map<string, ForeignKeyEdge[]>();
  for (const edge of edges) {
    const list = byParent.get(edge.parent) ?? [];
    list.push(edge);
    byParent.set(edge.parent, list);
  }

  // Breadth-first over CASCADE edges (shortest chain per table). A cascade into
  // an evidence table is reported but not followed further.
  const chains = new Map<string, readonly ForeignKeyEdge[]>([[root, []]]);
  const queue: string[] = [root];
  const impacts: EvidenceImpact[] = [];
  const seen = new Set<string>();

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    const chain = chains.get(current) ?? [];
    for (const edge of byParent.get(current) ?? []) {
      if (edge.table === current) continue;
      const key = `${describeEdge(edge)}>${edge.parent}`;
      if (isEvidenceTable(edge.table)) {
        if (seen.has(key)) continue;
        seen.add(key);
        impacts.push({
          evidence: edge.table,
          chain,
          edge,
          effect:
            edge.onDelete === "cascade"
              ? "deletes"
              : edge.onDelete === "set null" || edge.onDelete === "set default"
                ? "nulls"
                : "blocks",
        });
        continue;
      }
      if (edge.onDelete === "cascade" && !chains.has(edge.table)) {
        chains.set(edge.table, [...chain, edge]);
        queue.push(edge.table);
      }
    }
  }

  return sortedCopy(
    impacts,
    (a, b) =>
      a.evidence.localeCompare(b.evidence) ||
      describeEdge(a.edge).localeCompare(describeEdge(b.edge)),
  );
}

export type RetentionInventory = {
  evidenceTables: readonly {
    table: string;
    category: EvidenceCategory;
    incoming: readonly ForeignKeyEdge[];
  }[];
  roots: readonly {
    root: RetentionRoot;
    impacts: readonly EvidenceImpact[];
    cascadeClosure: readonly string[];
  }[];
  ownedPartEdges: readonly OwnedPartEdge[];
  softReferences: readonly SoftReference[];
  violations: readonly ForeignKeyEdge[];
};

export function cascadeClosure(root: string): readonly string[] {
  const edges = listForeignKeys();
  const reached = new Set<string>([root]);
  const queue = [root];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    for (const edge of edges) {
      if (
        edge.parent === current &&
        edge.onDelete === "cascade" &&
        !reached.has(edge.table)
      ) {
        reached.add(edge.table);
        queue.push(edge.table);
      }
    }
  }
  reached.delete(root);
  return sortedCopy(reached);
}

export function buildRetentionInventory(): RetentionInventory {
  const edges = listForeignKeys();
  const evidenceTables = listEvidenceTables().map((table) => {
    const category = evidenceCategory(table);
    if (category === null) throw new Error(`${table} is not evidence`);
    return {
      table,
      category,
      incoming: edges.filter((edge) => edge.parent === table),
    };
  });
  return {
    evidenceTables,
    roots: RETENTION_ROOTS.map((root) => ({
      root,
      impacts: evidenceImpactOf(root),
      cascadeClosure: cascadeClosure(root),
    })),
    ownedPartEdges: OWNED_PART_EDGES,
    softReferences: SOFT_REFERENCE_LOGS,
    violations: findEvidenceDeleteViolations(),
  };
}

// ---------------------------------------------------------------------------
// Organization footprint (purge)
// ---------------------------------------------------------------------------

function labOrganizationColumn(table: TableMeta): string | null {
  return (
    LAB_ORGANIZATION_COLUMNS.find((column) => table.columns.includes(column)) ??
    null
  );
}

export type ScopeSource =
  | { kind: "direct"; column: string }
  | { kind: "parent"; column: string; parent: string; parentColumn: string }
  | { kind: "soft"; column: string; parent: string; parentColumn: string };

function computeScopeSources(table: string): readonly ScopeSource[] {
  const meta = TABLES_BY_NAME.get(table);
  if (!meta || table === "organization") return [];
  const sources: ScopeSource[] = [];
  const direct = labOrganizationColumn(meta);
  // A table with its own organization column belongs to exactly that
  // organization, whatever its foreign keys point at: a row of laboratory B that
  // (wrongly) references a unit of laboratory A must block A's purge, not be
  // swept up by it.
  if (direct) return [{ kind: "direct", column: direct }];
  for (const edge of meta.foreignKeys) {
    const [column] = edge.columns;
    const [parentColumn] = edge.parentColumns;
    if (edge.columns.length !== 1 || !column || !parentColumn) continue;
    if (edge.parent === "organization" || edge.parent === table) continue;
    // Direct tenants win: a user, an asset type or a catalog row is not owned
    // by one organization just because it is referenced by one.
    if (scopeSourcesOf(edge.parent).length === 0) continue;
    sources.push({ kind: "parent", column, parent: edge.parent, parentColumn });
  }
  const soft = SOFT_REFERENCE_LOGS.find((entry) => entry.table === table);
  if (soft) {
    sources.push({
      kind: "soft",
      column: soft.column,
      parent: soft.entity,
      parentColumn: "id",
    });
  }
  return sources;
}

const scopeMemo = new Map<string, readonly ScopeSource[]>();
const scopeInProgress = new Set<string>();

/** Every way a row of `table` is tied to one LAB organization (memoized). */
export function scopeSourcesOf(table: string): readonly ScopeSource[] {
  const cached = scopeMemo.get(table);
  if (cached) return cached;
  if (scopeInProgress.has(table)) return [];
  scopeInProgress.add(table);
  const result = computeScopeSources(table);
  scopeInProgress.delete(table);
  scopeMemo.set(table, result);
  return result;
}

/**
 * SQL predicate selecting the rows of `table` that belong to the LAB
 * organization `organizationId`: its own organization column, a foreign key to
 * a row that belongs to it, or the soft-referenced entity of an audit log.
 * Returns null for tables that are not tenant data (user, catalogs, ...).
 */
export function organizationScopeSql(
  table: string,
  organizationId: string,
  trail: readonly string[] = [],
): SQL | null {
  if (trail.includes(table)) return null;
  const clauses: SQL[] = [];
  for (const source of scopeSourcesOf(table)) {
    if (source.kind === "direct") {
      clauses.push(sql`${sql.identifier(source.column)} = ${organizationId}`);
      continue;
    }
    const parentScope = organizationScopeSql(source.parent, organizationId, [
      ...trail,
      table,
    ]);
    if (!parentScope) continue;
    clauses.push(
      sql`${sql.identifier(source.column)} IN (SELECT ${sql.identifier(source.parentColumn)} FROM ${sql.identifier(source.parent)} WHERE ${parentScope})`,
    );
  }
  if (clauses.length === 0) return null;
  return sql.join(clauses, sql` OR `);
}

/** Tables holding rows of one LAB organization, in no particular order. */
export function organizationFootprint(): readonly string[] {
  return TABLES.filter((table) => scopeSourcesOf(table.name).length > 0).map(
    (table) => table.name,
  );
}

/**
 * Deletion order for the footprint: referencing tables before the tables they
 * reference. Edges that do not block a delete (SET NULL / SET DEFAULT) are
 * ignored. Throws on a cycle among the remaining edges.
 */
export function organizationErasureOrder(): readonly string[] {
  const footprint = new Set(organizationFootprint());
  const blockers = new Map<string, Set<string>>();
  for (const table of footprint) blockers.set(table, new Set());
  for (const edge of listForeignKeys()) {
    if (!footprint.has(edge.table) || !footprint.has(edge.parent)) continue;
    if (edge.table === edge.parent) continue;
    if (edge.onDelete === "set null" || edge.onDelete === "set default")
      continue;
    // `edge.table` must be deleted before `edge.parent`.
    blockers.get(edge.parent)?.add(edge.table);
  }
  const order: string[] = [];
  const remaining = new Set(footprint);
  while (remaining.size > 0) {
    const ready = sortedCopy(
      [...remaining].filter((table) =>
        [...(blockers.get(table) ?? [])].every(
          (child) => !remaining.has(child),
        ),
      ),
    );
    if (ready.length === 0) {
      throw new Error(
        `foreign-key cycle among ${sortedCopy(remaining).join(", ")}`,
      );
    }
    for (const table of ready) {
      order.push(table);
      remaining.delete(table);
    }
  }
  return order;
}

/** Record-date columns present on `table`, for the newest-evidence scan. */
export function recordDateColumns(table: string): readonly string[] {
  const meta = TABLES_BY_NAME.get(table);
  if (!meta) return [];
  return RECORD_DATE_COLUMNS.filter((column) => meta.columns.includes(column));
}
