/**
 * Tenancy of the data model (decision Q15: row-level security needs an
 * organization on every tenant row).
 *
 * Every table of `schema.ts` is exactly one of:
 *
 *   - TENANT: it carries `organization_id` / `lab_organization_id`, NOT NULL.
 *     Most tenant tables had one from the start; `ORGANIZATION_BACKFILL` lists
 *     the children that gained it in migration 0118 together with the parent the
 *     value was backfilled from (the "parent path" to the organization);
 *   - GLOBAL: it has no organization column on purpose, with the reason in
 *     `GLOBAL_TABLES` (identity, platform plumbing, global catalogs).
 *
 * A new table that is neither fails `tenancy.test.ts`, so the classification
 * cannot silently rot. docs/architecture/tenancy.md is generated from this module
 * and the schema (`pnpm --dir packages/db tenancy:doc`).
 *
 * It only reads drizzle metadata: it never touches a database.
 */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Column names that scope a row to a laboratory tenant. */
export const TENANT_COLUMNS = ["organization_id", "lab_organization_id"];

/**
 * Suffix of the composite (parent_id, organization_id) foreign keys that pair a
 * child with its parent's tenant. They repeat the action of the single-column
 * foreign key next to them, so they are an integrity check, not a delete edge:
 * records-retention.ts leaves them out of the delete graph.
 */
export const TENANT_FK_SUFFIX = "_tenant_fk";

/** Tables without an organization column, and why that is correct. */
export const GLOBAL_TABLES: Readonly<Record<string, string>> = {
  organization:
    "The tenant root itself: its id is the organization (a CLIENT organization belongs to a portal customer).",
  user: "Identity (Better Auth). A person can belong to several organizations; the membership is `member`.",
  session:
    "Identity (Better Auth). Only a pointer (`active_organization_id`) to the organization chosen at sign-in.",
  account:
    "Identity (Better Auth): credentials of a user, shared by all their memberships.",
  passkey:
    "Identity (Better Auth): credentials of a user, shared by all their memberships.",
  verification:
    "Identity (Better Auth): one-time tokens (magic links, e-mail verification) keyed by identifier.",
  notification_preference:
    "Per-user preference (`user_id`, unique): follows the person across organizations.",
  asset_type:
    "Global catalog of instrument types shared by every laboratory (slug unique platform-wide).",
  legal_metrology_regulation:
    "Global regulatory catalog (Inmetro regimes by category), read-only for laboratories.",
  app_queue_job:
    "Platform job queue: an opaque payload and a lease, not tenant data. The jobs it carries re-check their organization.",
  queue_job_receipt:
    "Platform delivery ledger of queue messages (at-least-once dedupe).",
  cron_run: "Platform scheduler ledger (one row per cron run).",
  public_code_redeem_throttle:
    "Abuse throttle keyed by client address and time window, before any organization is known.",
  email_suppression:
    "Deliverability list keyed by recipient address: a bounced or complained address is suppressed for every sender.",
  email_webhook_event:
    "Idempotency ledger of provider webhooks (svix id), before any organization is known.",
  platform_event_log:
    "Platform-level evidence (sign-ups, impersonation, sign-in events): never purged with an organization.",
};

/**
 * Tenant tables created by migrations AFTER 0118. They are born with
 * `organization_id` (NOT NULL, RESTRICT) and, where they point at a tenant
 * parent, with the same composite (parent_id, organization_id) key, but they are
 * not part of 0118's backfill: its specs and its emulation of the database as it
 * was before the migration leave them out.
 */
export const CREATED_AFTER_0118: readonly string[] = [
  "certificate_input",
  "issued_certificate_status_event",
];

/**
 * Tenant children that gained `organization_id` in migration 0118. `column` is
 * the child column that points at `parent` (its `id`); `parentOrgColumn` is the
 * parent's own organization column the value was backfilled from. A `soft`
 * child points at its entity without a foreign key (append-only audit logs: the
 * row survives the deletion of the entity it documents).
 *
 * Order matters: a parent is listed before its children (the migration
 * backfills in this order).
 */
export type OrganizationBackfill = {
  table: string;
  column: string;
  parent: string;
  parentOrgColumn: string;
  soft?: true;
};

export const ORGANIZATION_BACKFILL: readonly OrganizationBackfill[] = [
  // finance
  {
    table: "receivable_installment",
    column: "document_id",
    parent: "billing_document",
    parentOrgColumn: "organization_id",
  },
  {
    table: "payment_receipt",
    column: "installment_id",
    parent: "receivable_installment",
    parentOrgColumn: "organization_id",
  },
  {
    table: "billing_document_item",
    column: "document_id",
    parent: "billing_document",
    parentOrgColumn: "organization_id",
  },
  {
    table: "billing_group_service_order",
    column: "group_id",
    parent: "billing_group",
    parentOrgColumn: "organization_id",
  },
  {
    table: "commercial_agreement_service_term",
    column: "agreement_id",
    parent: "commercial_agreement",
    parentOrgColumn: "organization_id",
  },
  {
    table: "commercial_agreement_unit_scope",
    column: "agreement_id",
    parent: "commercial_agreement",
    parentOrgColumn: "organization_id",
  },
  // technical records
  {
    table: "job_standard",
    column: "job_id",
    parent: "calibration_job",
    parentOrgColumn: "organization_id",
  },
  {
    table: "asset_oot_impact_assessment",
    column: "event_id",
    parent: "asset_oot_event",
    parentOrgColumn: "lab_organization_id",
  },
  {
    table: "calibration_request_item",
    column: "request_id",
    parent: "calibration_request",
    parentOrgColumn: "organization_id",
  },
  // service orders
  {
    table: "service_order_asset_snapshot",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_attachment",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_certificate_link",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_delivery_document",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_email_log",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_evaluation",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_execution",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_execution_item",
    column: "execution_id",
    parent: "service_order_execution",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_intake_document",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_quote",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_quote_item",
    column: "quote_id",
    parent: "service_order_quote",
    parentOrgColumn: "organization_id",
  },
  {
    table: "service_order_tag",
    column: "service_order_id",
    parent: "service_order",
    parentOrgColumn: "organization_id",
  },
  // audit logs: soft reference to the entity they document
  {
    table: "asset_audit_log",
    column: "asset_id",
    parent: "asset",
    parentOrgColumn: "lab_organization_id",
    soft: true,
  },
  {
    table: "asset_oot_audit_log",
    column: "event_id",
    parent: "asset_oot_event",
    parentOrgColumn: "lab_organization_id",
    soft: true,
  },
  {
    table: "authorized_signatory_audit_log",
    column: "signatory_id",
    parent: "authorized_signatory",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "calibration_request_audit_log",
    column: "request_id",
    parent: "calibration_request",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "control_chart_audit_log",
    column: "control_chart_id",
    parent: "control_chart",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "corrective_action_audit_log",
    column: "capa_id",
    parent: "corrective_action",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "customer_audit_log",
    column: "customer_id",
    parent: "customer",
    parentOrgColumn: "lab_organization_id",
    soft: true,
  },
  {
    table: "job_audit_log",
    column: "job_id",
    parent: "calibration_job",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "method_audit_log",
    column: "method_id",
    parent: "calibration_method",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "non_conformance_audit_log",
    column: "nc_id",
    parent: "non_conformance",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "personnel_competence_audit_log",
    column: "competence_id",
    parent: "personnel_competence",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "proficiency_test_audit_log",
    column: "proficiency_test_id",
    parent: "proficiency_test",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "reference_standard_audit_log",
    column: "standard_id",
    parent: "reference_standard",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "service_audit_log",
    column: "service_id",
    parent: "service",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "training_record_audit_log",
    column: "training_record_id",
    parent: "training_record",
    parentOrgColumn: "organization_id",
    soft: true,
  },
  {
    table: "visit_audit_log",
    column: "visit_id",
    parent: "calibration_visit",
    parentOrgColumn: "organization_id",
    soft: true,
  },
];

export type ReferentialAction =
  | "cascade"
  | "restrict"
  | "no action"
  | "set null"
  | "set default";

export type TenantColumn = {
  name: string;
  notNull: boolean;
  /** Foreign key of this column to `organization`, when it has one. */
  organizationFk: ReferentialAction | null;
  /** A non-partial index led by this column exists. */
  indexed: boolean;
};

export type CompositeTenantKey = {
  name: string;
  table: string;
  /** The child's pointer column (the second column of the pair). */
  column: string;
  parent: string;
  parentOrgColumn: string;
  onDelete: ReferentialAction;
};

export type TableTenancy = {
  name: string;
  columns: readonly string[];
  tenantColumns: readonly TenantColumn[];
  /** Foreign keys that are not tenant pairs, single column only. */
  singleForeignKeys: readonly {
    column: string;
    parent: string;
    onDelete: ReferentialAction;
    nullable: boolean;
  }[];
  compositeKeys: readonly CompositeTenantKey[];
  /** `UNIQUE (id, <org column>)` constraints: targets of composite keys. */
  orgIdUniques: readonly { name: string; orgColumn: string }[];
};

function action(value: string | undefined): ReferentialAction {
  switch (value) {
    case "cascade":
    case "restrict":
    case "set null":
    case "set default":
    case "no action":
      return value;
    default:
      return "no action";
  }
}

function readTenancy(): readonly TableTenancy[] {
  const tables: TableTenancy[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const tenantColumns: TenantColumn[] = [];
    for (const column of config.columns) {
      if (!TENANT_COLUMNS.includes(column.name)) continue;
      const fk = config.foreignKeys.find((candidate) => {
        const reference = candidate.reference();
        return (
          reference.columns.length === 1 &&
          reference.columns[0]?.name === column.name &&
          getTableConfig(reference.foreignTable).name === "organization"
        );
      });
      tenantColumns.push({
        name: column.name,
        notNull: column.notNull,
        organizationFk: fk ? action(fk.onDelete) : null,
        indexed: config.indexes.some(
          (index) =>
            index.config.where === undefined &&
            index.config.columns[0] !== undefined &&
            "name" in index.config.columns[0] &&
            index.config.columns[0].name === column.name,
        ),
      });
    }

    const compositeKeys: CompositeTenantKey[] = [];
    const singleForeignKeys: TableTenancy["singleForeignKeys"][number][] = [];
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const columns = reference.columns.map((column) => column.name);
      const parent = getTableConfig(reference.foreignTable).name;
      if (foreignKey.getName().endsWith(TENANT_FK_SUFFIX)) {
        const [column, orgColumn] = columns;
        const [parentId, parentOrgColumn] = reference.foreignColumns.map(
          (parentColumn) => parentColumn.name,
        );
        if (
          columns.length !== 2 ||
          !column ||
          !orgColumn ||
          !TENANT_COLUMNS.includes(orgColumn) ||
          parentId !== "id" ||
          !parentOrgColumn ||
          !TENANT_COLUMNS.includes(parentOrgColumn)
        ) {
          throw new Error(
            `${config.name}: ${foreignKey.getName()} is not a (pointer, organization) -> (id, organization) pair`,
          );
        }
        compositeKeys.push({
          name: foreignKey.getName(),
          table: config.name,
          column,
          parent,
          parentOrgColumn,
          onDelete: action(foreignKey.onDelete),
        });
        continue;
      }
      const [column] = columns;
      if (columns.length === 1 && column) {
        singleForeignKeys.push({
          column,
          parent,
          onDelete: action(foreignKey.onDelete),
          nullable: reference.columns.some((candidate) => !candidate.notNull),
        });
      }
    }

    const orgIdUniques = config.uniqueConstraints.flatMap((unique) => {
      const [first, second] = unique.columns;
      if (
        unique.columns.length === 2 &&
        first &&
        second &&
        first.name === "id" &&
        TENANT_COLUMNS.includes(second.name)
      ) {
        return [{ name: unique.name ?? "", orgColumn: second.name }];
      }
      return [];
    });

    tables.push({
      name: config.name,
      columns: config.columns.map((column) => column.name),
      tenantColumns,
      singleForeignKeys,
      compositeKeys,
      orgIdUniques,
    });
  }
  // A (id, organization) unique that no tenant key points at (the integration_*
  // composite keys have their own) is not part of this design.
  const pairingParents = new Set(
    tables.flatMap((table) => table.compositeKeys.map((key) => key.parent)),
  );
  return tables
    .map((table) =>
      pairingParents.has(table.name) ? table : { ...table, orgIdUniques: [] },
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

const TABLES = readTenancy();
const BY_NAME = new Map(TABLES.map((table) => [table.name, table]));

export function listTenancy(): readonly TableTenancy[] {
  return TABLES;
}

export function tenancyOf(table: string): TableTenancy | undefined {
  return BY_NAME.get(table);
}

export type Classification = {
  /** Tables carrying an organization column. */
  tenant: readonly TableTenancy[];
  /** Tables without one, classified GLOBAL with a reason. */
  global: readonly { table: TableTenancy; reason: string }[];
  /** Without an organization column and not classified: must be empty. */
  unclassified: readonly string[];
  /** Classified GLOBAL although they carry an organization column: must be empty. */
  staleGlobal: readonly string[];
  /** Classified GLOBAL but absent from the schema: must be empty. */
  unknownGlobal: readonly string[];
};

export function classifyTables(): Classification {
  const tenant: TableTenancy[] = [];
  const global: { table: TableTenancy; reason: string }[] = [];
  const unclassified: string[] = [];
  const staleGlobal: string[] = [];
  for (const table of TABLES) {
    const reason = GLOBAL_TABLES[table.name];
    const hasOrganization = table.tenantColumns.length > 0;
    if (hasOrganization) {
      tenant.push(table);
      if (reason !== undefined) staleGlobal.push(table.name);
    } else if (reason !== undefined) {
      global.push({ table, reason });
    } else {
      unclassified.push(table.name);
    }
  }
  const unknownGlobal = Object.keys(GLOBAL_TABLES).filter(
    (name) => !BY_NAME.has(name),
  );
  return { tenant, global, unclassified, staleGlobal, unknownGlobal };
}

/**
 * Chain from a backfilled table to a table with a native organization column:
 * `payment_receipt -> receivable_installment -> billing_document`.
 */
export function parentPathOf(table: string): readonly string[] {
  const path = [table];
  let current = ORGANIZATION_BACKFILL.find((entry) => entry.table === table);
  while (current) {
    path.push(current.parent);
    const next = current.parent;
    current = ORGANIZATION_BACKFILL.find((entry) => entry.table === next);
  }
  return path;
}

/**
 * Foreign keys of a backfilled table that point at another tenant table through
 * a column that is set NULL when the target is deleted: no composite key can pair
 * them (a composite SET NULL would also null `organization_id`), so they stay a
 * single-column reference.
 */
export function unpairedPointers(): readonly {
  table: string;
  column: string;
  parent: string;
}[] {
  const pointers: { table: string; column: string; parent: string }[] = [];
  for (const entry of ORGANIZATION_BACKFILL) {
    const table = BY_NAME.get(entry.table);
    for (const foreignKey of table?.singleForeignKeys ?? []) {
      const target = BY_NAME.get(foreignKey.parent);
      if (!target || target.tenantColumns.length === 0) continue;
      if (foreignKey.onDelete !== "set null") continue;
      pointers.push({
        table: entry.table,
        column: foreignKey.column,
        parent: foreignKey.parent,
      });
    }
  }
  return pointers.sort(
    (a, b) =>
      a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );
}
