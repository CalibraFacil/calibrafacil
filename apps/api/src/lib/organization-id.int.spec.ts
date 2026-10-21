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
import { ORGANIZATION_BACKFILL } from "@calibra-facil/db/tenancy";
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
    it("REQ-ORG-2: every table of the migration has organization_id NOT NULL in Postgres", async () => {
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
      for (const row of rows) {
        expect(row.is_nullable, row.table_name).toBe("NO");
      }
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
      expect(missing.code).toBe("23502");
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
