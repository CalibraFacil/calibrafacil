/**
 * organization-id.int.spec.ts: real-Postgres proof that every tenant table
 * carries its organization (decision Q15, migration 0118,
 * docs/architecture/tenancy.md).
 *
 *   REQ-ORG-2  organization_id is NOT NULL, a foreign key to organization with
 *              ON DELETE RESTRICT (the migration itself is exercised against
 *              representative data in organization-id-migration.int.spec.ts)
 *   REQ-ORG-3  a child cannot point at another tenant's parent: the composite
 *              (organization_id, parent_id) key refuses it
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  billingDocument,
  billingDocumentItem,
  jobAuditLog,
  jobStandard,
  paymentReceipt,
  receivableInstallment,
  serviceOrderAssetSnapshot,
  serviceOrderCertificateLink,
  serviceOrderExecutionItem,
  serviceOrderQuoteItem,
} from "@calibra-facil/db/schema";
import {
  CREATED_AFTER_0118,
  ORGANIZATION_BACKFILL,
  listTenancy,
} from "@calibra-facil/db/tenancy";
import { truncateAll } from "../../test/integration/db";
import { hardDeleteOrganizationAsPurge } from "../../test/integration/records-retention";
import { QUOTE_ITEM, seedTenant } from "../../test/integration/tenancy-fixture";
import { extractPgConstraintName, extractPgErrorCode } from "./db-errors";
import { getExecuteRows } from "./db";

async function rejection(
  statement: PromiseLike<unknown>,
): Promise<{ code: string | undefined; constraint: string | undefined }> {
  try {
    await statement;
  } catch (error) {
    return {
      code: extractPgErrorCode(error),
      constraint: extractPgConstraintName(error),
    };
  }
  throw new Error("expected Postgres to refuse the statement");
}

describe("organization_id on every tenant table (migration 0118)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe("REQ-ORG-2: NOT NULL, foreign key to organization ON DELETE RESTRICT", () => {
    it("REQ-ORG-2: every table of the migration has organization_id NOT NULL in Postgres, except the 16 audit logs (nullable, CHECK NOT VALID)", async () => {
      const rows = getExecuteRows<{ table_name: string; is_nullable: string }>(
        await db.execute(sql`
          select table_name, is_nullable from information_schema.columns
           where table_schema = 'public' and column_name = 'organization_id'
             and table_name in (${sql.join(
               ORGANIZATION_BACKFILL.map((entry) => sql`${entry.table}`),
               sql`, `,
             )})`),
      );
      expect(rows.map((row) => row.table_name).toSorted()).toEqual(
        ORGANIZATION_BACKFILL.map((entry) => entry.table).toSorted(),
      );
      const auditLogs = new Set(
        ORGANIZATION_BACKFILL.filter((entry) => entry.soft).map(
          (entry) => entry.table,
        ),
      );
      for (const row of rows) {
        expect(row.is_nullable, row.table_name).toBe(
          auditLogs.has(row.table_name) ? "YES" : "NO",
        );
      }
      // ... and each of those carries the CHECK, which stays NOT VALID.
      const checks = getExecuteRows<{ table_name: string; validated: boolean }>(
        await db.execute(sql`
          select conrelid::regclass::text as table_name, convalidated as validated
            from pg_constraint
           where contype = 'c' and conname like '%\_organization\_id\_required'`),
      );
      expect(checks.map((row) => row.table_name).toSorted()).toEqual(
        [...auditLogs].toSorted(),
      );
    });

    it("REQ-ORG-2: ... and a foreign key to organization(id) with ON DELETE RESTRICT", async () => {
      const rows = getExecuteRows<{ table_name: string; action: string }>(
        await db.execute(sql`
          select conrelid::regclass::text as table_name, confdeltype::text as action
            from pg_constraint
           where contype = 'f' and confrelid = 'public.organization'::regclass
             and pg_get_constraintdef(oid) like 'FOREIGN KEY (organization_id)%'
             and conrelid::regclass::text in (${sql.join(
               ORGANIZATION_BACKFILL.map((entry) => sql`${entry.table}`),
               sql`, `,
             )})`),
      );
      expect(rows.map((row) => row.table_name).toSorted()).toEqual(
        ORGANIZATION_BACKFILL.map((entry) => entry.table).toSorted(),
      );
      for (const row of rows) {
        // 'r' = RESTRICT
        expect(row.action, row.table_name).toBe("r");
      }
    });

    it("REQ-ORG-2: a child row without an organization, or with an unknown one, is refused", async () => {
      const t = await seedTenant("org-a");
      const missing = await rejection(
        db.execute(
          sql`insert into job_audit_log (job_id, action, performed_by) values (${t.jobId}, 'x', ${t.userId})`,
        ),
      );
      // 23514 = check_violation: the audit logs refuse a NEW row without an organization.
      expect(missing.code).toBe("23514");
      expect(missing.constraint).toBe("job_audit_log_organization_id_required");
      const missingChild = await rejection(
        db.execute(
          sql`insert into job_standard (job_id, standard_id) values (${t.jobId}, ${t.standardId})`,
        ),
      );
      expect(missingChild.code).toBe("23502");
      const unknown = await rejection(
        db.insert(jobAuditLog).values({
          organizationId: "no-such-organization",
          jobId: t.jobId,
          action: "x",
          performedBy: t.userId,
        }),
      );
      expect(unknown.code).toBe("23503");
      expect(unknown.constraint).toBe(
        "job_audit_log_organization_id_organization_id_fk",
      );
    });

    it("REQ-ORG-2: deleting an organization that still has child rows is refused, not cascaded", async () => {
      const t = await seedTenant("org-a");
      await db.insert(jobAuditLog).values({
        organizationId: t.orgId,
        jobId: t.jobId,
        action: "create",
        performedBy: t.userId,
      });
      // Past the purge-only guard of the organization itself, the RESTRICT
      // foreign keys of the evidence refuse the delete.
      const refused = await rejection(hardDeleteOrganizationAsPurge(t.orgId));
      expect(["23001", "23503"]).toContain(refused.code);
      const [row] = getExecuteRows<{ remaining: string }>(
        await db.execute(
          sql`select count(*)::text as remaining from job_audit_log where organization_id = ${t.orgId}`,
        ),
      );
      expect(row?.remaining).toBe("1");
    });
  });

  describe("REQ-ORG-3: a child cannot point at another tenant's parent", () => {
    it("REQ-ORG-3: same-tenant children are accepted", async () => {
      const a = await seedTenant("org-a");
      await db.insert(billingDocumentItem).values({
        organizationId: a.orgId,
        documentId: a.documentId,
        description: "Item",
        quantity: 1,
        unitPriceCents: 1000,
        totalCents: 1000,
      });
      await db.insert(paymentReceipt).values({
        organizationId: a.orgId,
        installmentId: a.installmentId,
        recordedBy: a.userId,
        receivedAt: new Date("2026-02-02T00:00:00.000Z"),
        amountCents: 1000,
        paymentMethod: "PIX",
      });
      await db.insert(serviceOrderQuoteItem).values({
        organizationId: a.orgId,
        quoteId: a.quoteId,
        ...QUOTE_ITEM,
      });
      await db.insert(jobStandard).values({
        organizationId: a.orgId,
        jobId: a.jobId,
        standardId: a.standardId,
      });
      const [{ count }] = getExecuteRows<{ count: string }>(
        await db.execute(
          sql`select count(*)::text as count from job_standard where organization_id = ${a.orgId}`,
        ),
      );
      expect(count).toBe("1");
    });

    it("REQ-ORG-3: an installment, an invoice line and a receipt of org B cannot hang off org A's document / installment", async () => {
      const a = await seedTenant("org-a");
      const b = await seedTenant("org-b");

      const installment = await rejection(
        db.insert(receivableInstallment).values({
          organizationId: b.orgId,
          documentId: a.documentId,
          installmentNumber: 2,
          dueDate: new Date("2026-03-01T00:00:00.000Z"),
          amountCents: 1,
        }),
      );
      expect(installment).toEqual({
        code: "23503",
        constraint: "receivable_installment_document_id_tenant_fk",
      });

      const line = await rejection(
        db.insert(billingDocumentItem).values({
          organizationId: b.orgId,
          documentId: a.documentId,
          description: "x",
          quantity: 1,
          unitPriceCents: 1,
          totalCents: 1,
        }),
      );
      expect(line).toEqual({
        code: "23503",
        constraint: "billing_document_item_document_id_tenant_fk",
      });

      const receipt = await rejection(
        db.insert(paymentReceipt).values({
          organizationId: b.orgId,
          installmentId: a.installmentId,
          recordedBy: b.userId,
          receivedAt: new Date("2026-02-02T00:00:00.000Z"),
          amountCents: 1,
          paymentMethod: "PIX",
        }),
      );
      expect(receipt).toEqual({
        code: "23503",
        constraint: "payment_receipt_installment_id_tenant_fk",
      });
    });

    it("REQ-ORG-3: service-order children of org B cannot hang off org A's order, quote or execution", async () => {
      const a = await seedTenant("org-a");
      const b = await seedTenant("org-b");

      const snapshot = await rejection(
        db.insert(serviceOrderAssetSnapshot).values({
          organizationId: b.orgId,
          serviceOrderId: a.serviceOrderId,
          assetId: b.assetId,
          assetName: "x",
          assetType: "x",
        }),
      );
      expect(snapshot.constraint).toBe(
        "service_order_asset_snapshot_service_order_id_tenant_fk",
      );

      const quoteItem = await rejection(
        db.insert(serviceOrderQuoteItem).values({
          organizationId: b.orgId,
          quoteId: a.quoteId,
          ...QUOTE_ITEM,
        }),
      );
      expect(quoteItem).toEqual({
        code: "23503",
        constraint: "service_order_quote_item_quote_id_tenant_fk",
      });

      const executionItem = await rejection(
        db.insert(serviceOrderExecutionItem).values({
          organizationId: b.orgId,
          executionId: a.executionId,
          ...QUOTE_ITEM,
          unitCostCents: 0,
        }),
      );
      expect(executionItem).toEqual({
        code: "23503",
        constraint: "service_order_execution_item_execution_id_tenant_fk",
      });
    });

    it("REQ-ORG-3: a child of org A cannot point at org B's secondary parent (standard, certificate job)", async () => {
      const a = await seedTenant("org-a");
      const b = await seedTenant("org-b");

      const standard = await rejection(
        db.insert(jobStandard).values({
          organizationId: a.orgId,
          jobId: a.jobId,
          standardId: b.standardId,
        }),
      );
      expect(standard).toEqual({
        code: "23503",
        constraint: "job_standard_standard_id_tenant_fk",
      });

      const link = await rejection(
        db.insert(serviceOrderCertificateLink).values({
          organizationId: a.orgId,
          serviceOrderId: a.serviceOrderId,
          certificateJobId: b.jobId,
          linkedByUserId: a.userId,
        }),
      );
      expect(link).toEqual({
        code: "23503",
        constraint:
          "service_order_certificate_link_certificate_job_id_tenant_fk",
      });
    });

    it("REQ-ORG-3: the composite key cascades like its single-column twin (owned parts go with their owner)", async () => {
      const a = await seedTenant("org-a");
      await db.insert(billingDocumentItem).values({
        organizationId: a.orgId,
        documentId: a.documentId,
        description: "Item",
        quantity: 1,
        unitPriceCents: 1,
        totalCents: 1,
      });
      await db
        .delete(billingDocument)
        .where(
          and(
            eq(billingDocument.id, a.documentId),
            eq(billingDocument.organizationId, a.orgId),
          ),
        );
      const [{ count }] = getExecuteRows<{ count: string }>(
        await db.execute(
          sql`select (select count(*) from billing_document_item) + (select count(*) from receivable_installment) as count`,
        ),
      ).map((row) => ({ count: String(row.count) }));
      expect(count).toBe("0");
    });
  });
});

/**
 * A VALUES list that gives every NOT NULL column without a default of `table` a
 * placeholder of its type, so a probe row can be written without knowing the table.
 */
async function fillerRow(
  table: string,
  explicit: Record<string, string>,
): Promise<{ columns: string; values: string }> {
  const columns = getExecuteRows<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
    is_generated: string;
  }>(
    await db.execute(sql`
      select column_name, data_type, is_nullable, column_default, is_identity, is_generated
        from information_schema.columns
       where table_schema = 'public' and table_name = ${table}
       order by ordinal_position`),
  );
  const names: string[] = [];
  const values: string[] = [];
  for (const column of columns) {
    const explicitValue = explicit[column.column_name];
    if (explicitValue !== undefined) {
      names.push(`"${column.column_name}"`);
      values.push(explicitValue);
      continue;
    }
    if (
      column.is_nullable === "YES" ||
      column.column_default !== null ||
      column.is_identity === "YES" ||
      column.is_generated === "ALWAYS"
    ) {
      continue;
    }
    names.push(`"${column.column_name}"`);
    switch (column.data_type) {
      case "integer":
      case "bigint":
      case "smallint":
      case "numeric":
      case "real":
      case "double precision":
        values.push("1");
        break;
      case "boolean":
        values.push("false");
        break;
      case "jsonb":
      case "json":
        values.push("'{}'");
        break;
      case "ARRAY":
        values.push("'{}'");
        break;
      case "date":
      case "timestamp without time zone":
      case "timestamp with time zone":
        values.push("now()");
        break;
      default:
        values.push("'x'");
    }
  }
  return { columns: names.join(", "), values: values.join(", ") };
}

const COMPOSITE_KEYS = listTenancy().flatMap((table) => table.compositeKeys);

/** Filler values a table's CHECK constraints need (the generic 'x' would fail them). */
const CHECKED_FILLERS: Record<string, Record<string, string>> = {
  issued_certificate_status_event: { event: "'ISSUED'", source: "'api'" },
};

describe("REQ-ORG-3: every composite tenant key refuses a cross-tenant child (all of them, from the registry)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-ORG-3: the registry lists the 29 composite keys of migration 0118", () => {
    const migration0118 = COMPOSITE_KEYS.filter(
      (key) => !CREATED_AFTER_0118.includes(key.table),
    );
    expect(migration0118).toHaveLength(29);
    expect(new Set(migration0118.map((key) => key.name)).size).toBe(29);
    // later tables carry their own, and are held to the same refusal below
    expect(new Set(COMPOSITE_KEYS.map((key) => key.name)).size).toBe(
      COMPOSITE_KEYS.length,
    );
  });

  /**
   * Per key, in a transaction that is always rolled back: with the foreign keys
   * switched off for the session, store a probe parent of laboratory A and a probe
   * child of laboratory B that points at it; then switch them back on and re-create
   * the key from its own catalog definition. Re-creating validates the stored rows:
   * the cross-tenant child must make Postgres name this very constraint, and a child
   * of the parent's own laboratory must pass (the key is not vacuous).
   */
  async function recreateKeyOver(
    key: (typeof COMPOSITE_KEYS)[number],
    childOrganization: string,
  ): Promise<{
    code: string | undefined;
    constraint: string | undefined;
  } | null> {
    class Rollback extends Error {}
    let outcome: Awaited<ReturnType<typeof rejection>> | null = null;
    try {
      await db.transaction(async (tx) => {
        const definition = getExecuteRows<{ definition: string }>(
          await tx.execute(sql`
            select pg_get_constraintdef(oid) as definition from pg_constraint
             where conname = ${key.name} and conrelid = ${key.table}::regclass`),
        )[0]?.definition;
        if (!definition) throw new Error(`${key.name} does not exist`);

        await tx.execute(sql`set local session_replication_role = replica`);
        const parentRow = await fillerRow(key.parent, {
          [key.parentOrgColumn]: "'org-xt-a'",
        });
        const [parent] = getExecuteRows<{ id: number }>(
          await tx.execute(
            sql.raw(
              `insert into "${key.parent}" (${parentRow.columns}) values (${parentRow.values}) returning id`,
            ),
          ),
        );
        if (!parent) throw new Error("probe parent not stored");
        const childRow = await fillerRow(key.table, {
          ...CHECKED_FILLERS[key.table],
          organization_id: `'${childOrganization}'`,
          [key.column]: String(parent.id),
        });
        await tx.execute(
          sql.raw(
            `insert into "${key.table}" (${childRow.columns}) values (${childRow.values})`,
          ),
        );
        await tx.execute(sql`set local session_replication_role = origin`);

        const recreate = async () => {
          await tx.execute(
            sql.raw(`alter table "${key.table}" drop constraint "${key.name}"`),
          );
          await tx.execute(
            sql.raw(
              `alter table "${key.table}" add constraint "${key.name}" ${definition}`,
            ),
          );
        };
        outcome = await rejection(recreate());
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        // The drop/add failed: that is the refusal being measured; anything else is a bug.
        if (outcome === null) throw error;
      }
    }
    return outcome;
  }

  it.each(COMPOSITE_KEYS.map((key) => [key.name, key] as const))(
    "REQ-ORG-3: %s refuses a child of another laboratory and accepts a child of the parent's own",
    async (_name, key) => {
      const crossTenant = await recreateKeyOver(key, "org-xt-b");
      expect(crossTenant?.code).toBe("23503");
      expect(crossTenant?.constraint).toBe(key.name);
      // Same laboratory as the parent: re-creating the key succeeds (no rejection recorded).
      await expect(recreateKeyOver(key, "org-xt-a")).rejects.toThrow(
        "expected Postgres to refuse the statement",
      );
    },
  );
});
