/**
 * service-order-numbers-per-lab.int.spec.ts — the tag, quote, intake and delivery document
 * numbers derive from the per-laboratory service-order number, so they are unique PER
 * LABORATORY (P0-4, migration 0125; same class as NC/CAPA, migration 0124). Before the fix a
 * second laboratory's first order of the year collided with the first laboratory's on the
 * global unique indexes and the request failed.
 *
 *   REQ-SONUM-001  two labs each open their first order of the year with a tag, a quote, an
 *                  intake document and a delivery document: both succeed with the same numbers
 *   REQ-SONUM-002  within one laboratory the numbers stay unique: a repeated tag number or
 *                  intake document number and version is refused by the index
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  serviceOrderDeliveryDocument,
  serviceOrderIntakeDocument,
  serviceOrderQuote,
  serviceOrderTag,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { serviceOrdersRouter } from "./service-orders";

// The document jobs render PDFs; they are not under test here.
vi.mock("../lib/background-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/background-jobs")>()),
  enqueueBackgroundJob: vi.fn(async () => ({ messageId: "test-job" })),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET_NAME: "documents",
  R2_MEDIA_BUCKET_NAME: "media",
};

async function call(path: string, method: string, body?: unknown) {
  const res = await serviceOrdersRouter.request(
    path,
    {
      method,
      headers: JSON_HEADERS,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    ENV,
  );
  return { status: res.status, body: await res.json() };
}

/** Opens an order of `lab` and issues its tag, intake and delivery documents and a quote. */
async function issueEverything(lab: BillingLab) {
  loginAs({ userId: lab.userId, organizationId: lab.orgId });
  const opened = await call("/", "POST", {
    customerId: lab.customerId,
    assetId: lab.assetId,
    claimedDefect: "Nao liga",
    intakeCondition: "Riscos na carcaca",
  });
  expect(opened.status).toBe(201);
  const id: number = opened.body.data.id;
  const orderNumber: string = opened.body.data.serviceOrderNumber;

  const intake = await call(`/${id}/intake-document`, "POST");
  expect(intake.status).toBe(200);
  const tag = await call(`/${id}/tag`, "POST");
  expect(tag.status).toBe(200);
  const evaluation = await call(`/${id}/evaluations`, "POST", {
    diagnosis: "Fonte danificada",
    recommendedAction: "repair",
  });
  expect(evaluation.status).toBe(200);
  const quote = await call(`/${id}/quotes`, "POST", {
    items: [
      {
        type: "service",
        description: "Reparo",
        quantity: 1,
        unitPriceCents: 20_000,
      },
    ],
  });
  expect(quote.status).toBe(201);
  const delivery = await call(`/${id}/delivery-document`, "POST", {
    clientSignatureData: {
      signerName: "Joao",
      dataUrl: "data:image/png;base64,AAAA",
    },
  });
  expect(delivery.status).toBe(200);

  const intakeNumber: string = intake.body.data.documentNumber;
  const tagNumber: string = tag.body.data.tagNumber;
  const quoteNumber: string = quote.body.data.quoteNumber;
  const deliveryNumber: string = delivery.body.data.documentNumber;
  return {
    id,
    orderNumber,
    intake: intakeNumber,
    tag: tagNumber,
    quote: quoteNumber,
    delivery: deliveryNumber,
  };
}

describe("service-order document numbers are per laboratory (P0-4)", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.mocked(enqueueBackgroundJob).mockClear();
  });

  it("REQ-SONUM-001: two labs each open their first order of the year with a tag, quote, intake and delivery document; both succeed with the same numbers", async () => {
    const a = await seedBillingLab("org-a");
    const b = await seedBillingLab("org-b");

    const first = await issueEverything(a);
    const second = await issueEverything(b);

    // Same per-lab order number, so every derived document number is identical across labs.
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(first).toMatchObject({
      intake: `${first.orderNumber}/REC`,
      tag: `${first.orderNumber}-TAG-1`,
      quote: `${first.orderNumber}/ORC`,
      delivery: `${first.orderNumber}/ENT`,
    });
    expect({
      intake: second.intake,
      tag: second.tag,
      quote: second.quote,
      delivery: second.delivery,
    }).toEqual({
      intake: first.intake,
      tag: first.tag,
      quote: first.quote,
      delivery: first.delivery,
    });

    // Each lab owns exactly its own rows.
    for (const [lab, order] of [
      [a, first],
      [b, second],
    ] as const) {
      for (const table of [
        serviceOrderIntakeDocument,
        serviceOrderTag,
        serviceOrderQuote,
        serviceOrderDeliveryDocument,
      ]) {
        const rows = await db
          .select()
          .from(table)
          .where(eq(table.serviceOrderId, order.id));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.organizationId).toBe(lab.orgId);
      }
    }
  });

  it("REQ-SONUM-002: within one laboratory a number and version stay unique", async () => {
    const a = await seedBillingLab("org-a");
    const order = await issueEverything(a);

    await expect(
      db.insert(serviceOrderTag).values({
        organizationId: a.orgId,
        serviceOrderId: order.id,
        tagNumber: order.tag,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(serviceOrderIntakeDocument).values({
        organizationId: a.orgId,
        serviceOrderId: order.id,
        documentNumber: order.intake,
        version: 1,
      }),
    ).rejects.toThrow();
  });
});
