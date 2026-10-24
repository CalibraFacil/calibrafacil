import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { nonConformance, ootNotification } from "@calibra-facil/db/schema";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import {
  asString,
  envAsApplicationRole,
  field,
  toRows,
} from "../test/integration/application-role";
import { seedOrg } from "../test/integration/seed";
import {
  seedApprovedCertificate,
  seedPortalCustomer,
} from "../test/integration/seed-audit-pack";
import {
  seedDeliveryDocument,
  seedIntakeDocument,
  seedQuote,
  seedServiceOrder,
  seedTag,
} from "../test/integration/seed-service-order";

/**
 * The service-order document handlers and the out-of-tolerance letter as
 * `calibra_app` (P2-18j). A message names a service order (or a notification),
 * not its laboratory: the laboratory is learnt with one lookup on the owner
 * connection (`DATABASE_OWNER_URL`); the rows are read in a transaction that
 * names it, then the QR code, the logo, Gotenberg and storage run with no
 * transaction open, and the result is written in another one.
 *
 *   REQ-WRLS-SOD-1  intake, tag, quote and delivery receipt of laboratory A render only A's data and write
 *                   A's rows, as calibra_app
 *   REQ-WRLS-SOD-2  laboratory B's documents, tags and quotes are untouched
 *   REQ-WRLS-SOD-3  no transaction is open while Gotenberg is called
 *   REQ-WRLS-SOD-4  an unknown service order fails as before; without the owner connection under
 *                   enforced RLS the lookup fails loudly (retryable) instead of "not found"
 *   REQ-WRLS-SOD-5  an out-of-tolerance letter is generated for laboratory A's notification only
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

/** Records the HTML sent to Gotenberg and the open transactions at that moment. */
function installGotenbergRecorder(): {
  htmlBodies: string[];
  openTransactions: number[];
} {
  const htmlBodies: string[] = [];
  const openTransactions: number[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = init?.body;
    if (body instanceof FormData) {
      const filePart = body.get("files");
      if (filePart instanceof Blob) htmlBodies.push(await filePart.text());
    }
    const rows = toRows(
      await db.execute(
        sql`SELECT count(*)::int AS open FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND state LIKE 'idle in transaction%'`,
      ),
    );
    openTransactions.push(Number(field(rows[0], "open")));
    const buffer = new ArrayBuffer(FAKE_PDF_BYTES.byteLength);
    new Uint8Array(buffer).set(FAKE_PDF_BYTES);
    return new Response(buffer, { status: 200 });
  });
  return { htmlBodies, openTransactions };
}

function applicationEnv(options: { withOwnerUrl?: boolean } = {}): {
  env: Env;
  putKeys: string[];
} {
  const base = envAsApplicationRole({
    GOTENBERG_URL: "http://gotenberg.test",
    ...options,
  });
  const putKeys: string[] = [];
  const certificates = base.CERTIFICATES_BUCKET;
  return {
    putKeys,
    env: {
      ...base,
      CERTIFICATES_BUCKET: {
        get: (key) => certificates.get(key),
        put: (key, body, putOptions) => {
          putKeys.push(key);
          return certificates.put(key, body, putOptions);
        },
      },
    },
  };
}

async function pdfKey(table: string, id: number): Promise<unknown> {
  const rows = toRows(
    await db.execute(
      sql`SELECT pdf_r2_key FROM ${sql.identifier(table)} WHERE id = ${id}`,
    ),
  );
  return field(rows[0], "pdf_r2_key");
}

async function seedLab(orgId: string, suffix: string) {
  const org = await seedOrg({ orgId, userId: `user-${orgId}` });
  const so = await seedServiceOrder({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
    serviceOrderNumber: `OS-2026-${suffix}`,
    customerName: `Cliente ${suffix}`,
    assetName: `Balança ${suffix}`,
  });
  const intake = await seedIntakeDocument({
    serviceOrderId: so.serviceOrderId,
    serviceOrderNumber: so.serviceOrderNumber,
  });
  const tag = await seedTag({
    serviceOrderId: so.serviceOrderId,
    serviceOrderNumber: so.serviceOrderNumber,
  });
  const quote = await seedQuote({
    serviceOrderId: so.serviceOrderId,
    serviceOrderNumber: so.serviceOrderNumber,
    userId: org.userId,
  });
  const delivery = await seedDeliveryDocument({
    serviceOrderId: so.serviceOrderId,
    serviceOrderNumber: so.serviceOrderNumber,
    userId: org.userId,
  });
  return { org, so, intake, tag, quote, delivery };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("service-order documents as calibra_app (P2-18j)", () => {
  it("REQ-WRLS-SOD-1 REQ-WRLS-SOD-2 REQ-WRLS-SOD-3 [HIGH RISK] each document renders only its own laboratory's data and writes its own rows; no transaction is open during Gotenberg", async () => {
    const a = await seedLab("org-A", "A001");
    const b = await seedLab("org-B", "B001");
    const { env, putKeys } = applicationEnv();
    const { htmlBodies, openTransactions } = installGotenbergRecorder();

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_INTAKE_DOCUMENT",
      serviceOrderId: a.so.serviceOrderId,
      documentId: a.intake.documentId,
      userId: a.org.userId,
    });
    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_TAG",
      serviceOrderId: a.so.serviceOrderId,
      tagId: a.tag.tagId,
      userId: a.org.userId,
    });
    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_QUOTE",
      serviceOrderId: a.so.serviceOrderId,
      quoteId: a.quote.quoteId,
      userId: a.org.userId,
    });
    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_DELIVERY_RECEIPT",
      serviceOrderId: a.so.serviceOrderId,
      documentId: a.delivery.documentId,
      userId: a.org.userId,
    });

    // Laboratory A's four rows carry their PDF key, org-partitioned.
    for (const [table, id] of [
      ["service_order_intake_document", a.intake.documentId],
      ["service_order_tag", a.tag.tagId],
      ["service_order_quote", a.quote.quoteId],
      ["service_order_delivery_document", a.delivery.documentId],
    ] as const) {
      const key = asString(await pdfKey(table, id));
      expect(key).toContain("-org-A/");
      expect(putKeys).toContain(key);
    }
    expect(htmlBodies).toHaveLength(4);
    for (const html of htmlBodies) {
      expect(html).toContain("OS-2026-A001");
      expect(html).not.toContain("OS-2026-B001");
      expect(html).not.toContain("Cliente B001");
    }

    // Laboratory B: nothing written.
    for (const [table, id] of [
      ["service_order_intake_document", b.intake.documentId],
      ["service_order_tag", b.tag.tagId],
      ["service_order_quote", b.quote.quoteId],
      ["service_order_delivery_document", b.delivery.documentId],
    ] as const) {
      expect(await pdfKey(table, id)).toBeNull();
    }

    // Gotenberg was called four times, each with no transaction open.
    expect(openTransactions).toEqual([0, 0, 0, 0]);
  });

  it("REQ-WRLS-SOD-4 an unknown service order fails as before; without the owner connection under enforced RLS the lookup fails loudly", async () => {
    const a = await seedLab("org-A", "A001");
    installGotenbergRecorder();

    await expect(
      processBackgroundJob(applicationEnv().env, {
        type: "SERVICE_ORDER_TAG",
        serviceOrderId: 999_999,
        tagId: undefined,
        userId: a.org.userId,
      }),
    ).rejects.toThrow("Service order not found");

    await expect(
      processBackgroundJob(applicationEnv({ withOwnerUrl: false }).env, {
        type: "SERVICE_ORDER_TAG",
        serviceOrderId: a.so.serviceOrderId,
        tagId: a.tag.tagId,
        userId: a.org.userId,
      }),
    ).rejects.toThrow(/DATABASE_OWNER_URL/);
    expect(await pdfKey("service_order_tag", a.tag.tagId)).toBeNull();
  });

  it("REQ-WRLS-SOD-5 an out-of-tolerance letter is generated for the laboratory's own notification only", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    const notifications: Record<string, number> = {};
    for (const org of [orgA, orgB]) {
      const customerRow = await seedPortalCustomer({
        organizationId: org.orgId,
      });
      const cert = await seedApprovedCertificate({
        organizationId: org.orgId,
        unitId: org.unitId,
        userId: org.userId,
        customerId: customerRow.customerId,
        jobNumber: `CAL-${org.orgId}-1`,
      });
      const [nc] = await db
        .insert(nonConformance)
        .values({
          ncNumber: `NC-${org.orgId}-1`,
          organizationId: org.orgId,
          type: "out_of_tolerance",
          description: "Medição fora de tolerância",
          detectedBy: org.userId,
          detectedAt: new Date("2026-01-15T10:00:00.000Z"),
          status: "open",
          jobId: cert.jobId,
          createdBy: org.userId,
        })
        .returning();
      if (!nc) throw new Error("nc insert failed");
      const [row] = await db
        .insert(ootNotification)
        .values({
          organizationId: org.orgId,
          ncId: nc.id,
          jobId: cert.jobId,
          certificateNumber: `CERT-${org.orgId}`,
          recipientName: "Cliente",
          recipientEmail: "cliente@example.test",
          status: "PENDING",
          approvedBy: org.userId,
        })
        .returning();
      if (!row) throw new Error("oot insert failed");
      notifications[org.orgId] = row.id;
    }
    const { env, putKeys } = applicationEnv();
    const { htmlBodies, openTransactions } = installGotenbergRecorder();
    const idA = notifications["org-A"];
    const idB = notifications["org-B"];
    if (idA === undefined || idB === undefined) throw new Error("seed failed");

    await processBackgroundJob(env, {
      type: "OOT_NOTIFICATION",
      notificationId: idA,
      userId: orgA.userId,
    });

    const state = async (id: number) => {
      const row = toRows(
        await db.execute(
          sql`SELECT status, pdf_r2_key FROM oot_notification WHERE id = ${id}`,
        ),
      )[0];
      return {
        status: asString(field(row, "status")),
        pdfKey: field(row, "pdf_r2_key"),
      };
    };
    const after = await state(idA);
    expect(after.status).toBe("GENERATED");
    expect(putKeys).toContain(asString(after.pdfKey));
    expect(htmlBodies).toHaveLength(1);
    expect(htmlBodies[0]).toContain("NC-org-A-1");
    expect(htmlBodies[0]).not.toContain("NC-org-B-1");
    expect(openTransactions).toEqual([0]);
    expect(await state(idB)).toEqual({ status: "PENDING", pdfKey: null });
  });
});
