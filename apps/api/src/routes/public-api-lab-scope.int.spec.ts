/**
 * public-api-lab-scope.int.spec.ts - P2-18h [HIGH RISK].
 *
 * The public API (v1 and v2), the API-key authentication and the webhook
 * delivery run every statement after the key lookup in a transaction that names
 * the KEY's laboratory (row-level security). The specs of the routers cover their
 * contracts; this one covers the success paths they do not reach, each with a
 * cross-laboratory negative:
 *
 *   REQ-18H-PAPI-1  A key reads only its own laboratory's rows (lists, by id)
 *                   across v1 and v2; another laboratory's id answers 404.
 *   REQ-18H-PAPI-2  A key cannot write another laboratory's rows by id (PUT /
 *                   DELETE assets and customers, PATCH / cancel requests, a
 *                   request or an asset created against another laboratory's
 *                   customer): refused, and the rows stay as they were.
 *   REQ-18H-PAPI-3  A request created, edited and canceled through the API
 *                   commits the request, its items, its audit entries and the
 *                   caller's external id under the key's laboratory.
 *   REQ-18H-PAPI-4  An asset updated and deleted through the API commits its
 *                   audit entries with the change; a tag collision leaves no
 *                   audit entry behind.
 *   REQ-18H-PAPI-5  A webhook endpoint of laboratory A receives A's events,
 *                   signed with its secret, and NEVER laboratory B's; B's key
 *                   cannot list, test, edit, delete or replay A's endpoint.
 *   REQ-18H-PAPI-6  A request through a key touches that key's last-use stamp
 *                   only.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { processBackgroundJob } from "@calibra-facil/jobs-core";
import {
  appQueueJob,
  asset,
  assetAuditLog,
  calibrationRequest,
  calibrationRequestAuditLog,
  calibrationRequestItem,
  customer,
  organizationApiKey,
  publicApiResourceRef,
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import { parseBackgroundJobMessage } from "@calibra-facil/schemas";
import { routeOutboundThroughGlobalFetch } from "@calibra-facil/shared/outbound-testing";
import { ALL_PUBLIC_API_SCOPES } from "../lib/api-keys";
import {
  stagePublicApiWebhookEvent,
  withPublicApiWebhookTransaction,
} from "../lib/public-api-webhooks";
import { truncateAll } from "../../test/integration/db";
import {
  seedApprovedJob,
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { seedApiKey } from "../../test/integration/seed";
import { publicApiRouter } from "./public-api";
import { publicApiV2Router } from "./public-api-v2";

const ENV = {
  PUBLIC_API_MASTER_KEY: Buffer.alloc(32).toString("base64"),
};

type Router = {
  request: (
    path: string,
    init?: RequestInit,
    env?: unknown,
  ) => Response | Promise<Response>;
};

async function send(
  rawKey: string,
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
  router: Router = publicApiV2Router,
) {
  const headers: Record<string, string> = { "x-api-key": rawKey };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return router.request(
    path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    ENV,
  );
}

async function jsonOf(response: Response) {
  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("expected a JSON object");
  }
  return parsed;
}

function dataOf(body: unknown): Record<string, unknown> {
  const data: unknown = Reflect.get(Object(body), "data");
  if (typeof data !== "object" || data === null) {
    throw new Error("response has no data object");
  }
  return Object.fromEntries(Object.entries(data));
}

function listOf(body: unknown): Array<Record<string, unknown>> {
  const data: unknown = Reflect.get(Object(body), "data");
  if (!Array.isArray(data)) throw new Error("response has no data list");
  return data.map((row) => Object.fromEntries(Object.entries(Object(row))));
}

/**
 * Plays the worker: runs every WEBHOOK_DELIVERY job waiting in `app_queue_job`
 * through the real handler and settles the row. Returns how many it ran.
 */
async function drainWebhookQueue() {
  const rows = await db
    .select()
    .from(appQueueJob)
    .where(eq(appQueueJob.status, "PENDING"));
  const env = {
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    DATABASE_OWNER_URL: process.env.DATABASE_OWNER_URL,
    PUBLIC_API_MASTER_KEY: ENV.PUBLIC_API_MASTER_KEY,
    CERTIFICATES_BUCKET: { get: async () => null, put: async () => {} },
    MEDIA_BUCKET: { get: async () => null, put: async () => {} },
  };
  for (const row of rows) {
    expect(row.type).toBe("WEBHOOK_DELIVERY");
    const parsed = parseBackgroundJobMessage(row.payload);
    if (!parsed.ok) throw new Error(parsed.reason);
    // oxlint-disable-next-line eslint/no-await-in-loop -- the queue runs its jobs one after the other.
    await processBackgroundJob(env, parsed.message, {
      attempt: row.attempts + 1,
      maxAttempts: row.maxAttempts,
    });
    // oxlint-disable-next-line eslint/no-await-in-loop -- settles the row just run.
    await db
      .update(appQueueJob)
      .set({ status: "COMPLETED" })
      .where(eq(appQueueJob.id, row.id));
  }
  return rows.length;
}

type World = {
  a: BillingLab;
  b: BillingLab;
  keyA: string;
  keyB: string;
  keyAId: string;
  keyBId: string;
  jobA: number;
  jobB: number;
};

async function seedWorld(): Promise<World> {
  const a = await seedBillingLab("lab-a");
  const b = await seedBillingLab("lab-b");
  const keyA = await seedApiKey({
    organizationId: a.orgId,
    createdBy: a.userId,
    scopes: [...ALL_PUBLIC_API_SCOPES],
    keyId: "key-a",
  });
  const keyB = await seedApiKey({
    organizationId: b.orgId,
    createdBy: b.userId,
    scopes: [...ALL_PUBLIC_API_SCOPES],
    keyId: "key-b",
  });
  const jobA = await seedApprovedJob(a, "CAL-A-0001");
  const jobB = await seedApprovedJob(b, "CAL-B-0001");
  return {
    a,
    b,
    keyA: keyA.rawKey,
    keyB: keyB.rawKey,
    keyAId: keyA.keyId,
    keyBId: keyB.keyId,
    jobA,
    jobB,
  };
}

async function createRequest(
  key: string,
  lab: BillingLab,
  idempotencyKey: string,
  extra: Record<string, unknown> = {},
) {
  return send(
    key,
    "POST",
    "/requests",
    {
      customerId: lab.customerId,
      assetIds: [lab.assetId],
      observations: "Calibração do paquímetro",
      ...extra,
    },
    idempotencyKey,
  );
}

describe("public API: laboratory scope of the key (P2-18h)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("REQ-18H-PAPI-1: v2 and v1 reads return only the key's laboratory, by list and by id", async () => {
    const w = await seedWorld();

    const customers = listOf(
      await jsonOf(await send(w.keyA, "GET", "/customers")),
    );
    expect(customers.map((row) => row.id)).toEqual([w.a.customerId]);

    const assets = listOf(await jsonOf(await send(w.keyA, "GET", "/assets")));
    expect(assets.map((row) => row.id)).toEqual([w.a.assetId]);

    const services = listOf(
      await jsonOf(await send(w.keyA, "GET", "/services")),
    );
    expect(services.map((row) => row.id)).toEqual([w.a.serviceId]);

    const units = listOf(await jsonOf(await send(w.keyA, "GET", "/units")));
    expect(units.map((row) => row.id)).toEqual([w.a.unitId]);

    const jobs = listOf(await jsonOf(await send(w.keyA, "GET", "/jobs")));
    expect(jobs.map((row) => row.id)).toEqual([w.jobA]);

    const certificates = listOf(
      await jsonOf(await send(w.keyA, "GET", "/certificates")),
    );
    expect(certificates.map((row) => row.jobId)).toEqual(["CAL-A-0001"]);

    // By id: the same ids of the other laboratory answer as missing.
    for (const path of [
      `/customers/${w.b.customerId}`,
      `/assets/${w.b.assetId}`,
      `/services/${w.b.serviceId}`,
      `/units/${w.b.unitId}`,
      `/jobs/${w.jobB}`,
      "/certificates/CAL-B-0001",
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- few sequential requests.
      expect((await send(w.keyA, "GET", path)).status, path).toBe(404);
    }
    expect((await send(w.keyA, "GET", `/jobs/${w.jobA}`)).status).toBe(200);

    // v1: the same wall.
    const v1Customers = listOf(
      await jsonOf(
        await send(
          w.keyA,
          "GET",
          "/customers",
          undefined,
          undefined,
          publicApiRouter,
        ),
      ),
    );
    expect(v1Customers.map((row) => row.id)).toEqual([w.a.customerId]);
    const v1Jobs = listOf(
      await jsonOf(
        await send(
          w.keyA,
          "GET",
          "/jobs",
          undefined,
          undefined,
          publicApiRouter,
        ),
      ),
    );
    expect(v1Jobs.map((row) => row.jobId)).toEqual(["CAL-A-0001"]);
    expect(
      (
        await send(
          w.keyA,
          "GET",
          "/jobs/CAL-B-0001",
          undefined,
          undefined,
          publicApiRouter,
        )
      ).status,
    ).toBe(404);
  });

  it("REQ-18H-PAPI-2: a key cannot write another laboratory's rows by id, and they stay as they were", async () => {
    const w = await seedWorld();
    const requestB = dataOf(
      await jsonOf(await createRequest(w.keyB, w.b, "b-request-1")),
    );
    const requestBId = Number(requestB.id);

    expect(
      (await send(w.keyA, "PUT", `/assets/${w.b.assetId}`, { name: "Tomado" }))
        .status,
    ).toBe(404);
    expect(
      (
        await send(
          w.keyA,
          "DELETE",
          `/assets/${w.b.assetId}`,
          undefined,
          "del-a-1",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send(w.keyA, "PUT", `/customers/${w.b.customerId}`, {
          name: "Tomado",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          w.keyA,
          "DELETE",
          `/customers/${w.b.customerId}`,
          undefined,
          "del-a-2",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send(w.keyA, "PATCH", `/requests/${requestBId}`, {
          observations: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          w.keyA,
          "POST",
          `/requests/${requestBId}/cancel`,
          { reason: "Sem motivo" },
          "cancel-a-1",
        )
      ).status,
    ).toBe(404);
    // A request (or an asset) against the other laboratory's customer.
    expect(
      (
        await createRequest(w.keyA, w.a, "a-request-x", {
          customerId: w.b.customerId,
        })
      ).status,
    ).toBe(404);

    const [assetRow] = await db
      .select({ name: asset.name, deletedAt: asset.deletedAt })
      .from(asset)
      .where(eq(asset.id, w.b.assetId));
    expect(assetRow).toEqual({ name: `Instrument lab-b`, deletedAt: null });
    const [customerRow] = await db
      .select({ name: customer.name })
      .from(customer)
      .where(eq(customer.id, w.b.customerId));
    expect(customerRow?.name).toBe("Customer lab-b");
    const [requestRow] = await db
      .select({
        status: calibrationRequest.status,
        observations: calibrationRequest.observations,
      })
      .from(calibrationRequest)
      .where(eq(calibrationRequest.id, requestBId));
    expect(requestRow).toEqual({
      status: "PENDING",
      observations: "Calibração do paquímetro",
    });
    // No audit entry of laboratory A names a row of laboratory B.
    const audits = await db
      .select({ id: assetAuditLog.id })
      .from(assetAuditLog)
      .where(eq(assetAuditLog.organizationId, w.a.orgId));
    expect(audits).toEqual([]);
  });

  it("REQ-18H-PAPI-3: a request created, edited and canceled commits its rows under the key's laboratory", async () => {
    const w = await seedWorld();

    const created = await createRequest(w.keyA, w.a, "a-request-1", {
      externalId: "ERP-REQ-1",
    });
    expect(created.status).toBe(201);
    const requestId = Number(dataOf(await jsonOf(created)).id);

    const rows = await db
      .select({
        organizationId: calibrationRequest.organizationId,
        customerId: calibrationRequest.customerId,
        status: calibrationRequest.status,
      })
      .from(calibrationRequest)
      .where(eq(calibrationRequest.id, requestId));
    expect(rows).toEqual([
      {
        organizationId: w.a.orgId,
        customerId: w.a.customerId,
        status: "PENDING",
      },
    ]);
    const items = await db
      .select({
        organizationId: calibrationRequestItem.organizationId,
        assetId: calibrationRequestItem.assetId,
      })
      .from(calibrationRequestItem)
      .where(eq(calibrationRequestItem.requestId, requestId));
    expect(items).toEqual([
      { organizationId: w.a.orgId, assetId: w.a.assetId },
    ]);
    const [ref] = await db
      .select({
        organizationId: publicApiResourceRef.organizationId,
        resourceId: publicApiResourceRef.resourceId,
      })
      .from(publicApiResourceRef)
      .where(eq(publicApiResourceRef.externalId, "ERP-REQ-1"));
    expect(ref).toEqual({
      organizationId: w.a.orgId,
      resourceId: String(requestId),
    });

    // By the caller's own external id, and the other key cannot resolve it.
    const byExternal = await send(w.keyA, "GET", "/requests/ERP-REQ-1");
    expect(byExternal.status).toBe(200);
    expect(dataOf(await jsonOf(byExternal)).id).toBe(requestId);
    expect((await send(w.keyB, "GET", "/requests/ERP-REQ-1")).status).toBe(404);
    expect(
      listOf(await jsonOf(await send(w.keyB, "GET", "/requests"))),
    ).toEqual([]);

    const patched = await send(w.keyA, "PATCH", `/requests/${requestId}`, {
      observations: "Observação revisada",
    });
    expect(patched.status).toBe(200);
    const canceled = await send(
      w.keyA,
      "POST",
      `/requests/${requestId}/cancel`,
      { reason: "Cliente desistiu" },
      "a-cancel-1",
    );
    expect(canceled.status).toBe(200);
    // A canceled request is not editable any more.
    expect(
      (
        await send(w.keyA, "PATCH", `/requests/${requestId}`, {
          observations: "z",
        })
      ).status,
    ).toBe(409);

    const audit = await db
      .select({
        action: calibrationRequestAuditLog.action,
        organizationId: calibrationRequestAuditLog.organizationId,
      })
      .from(calibrationRequestAuditLog)
      .where(eq(calibrationRequestAuditLog.requestId, requestId));
    expect(audit.map((row) => row.action).toSorted()).toEqual([
      "create",
      "reject",
      "update",
    ]);
    expect(new Set(audit.map((row) => row.organizationId))).toEqual(
      new Set([w.a.orgId]),
    );
  });

  it("REQ-18H-PAPI-4: an asset update and delete commit their audit entries; a tag collision leaves none", async () => {
    const w = await seedWorld();

    const updated = await send(w.keyA, "PUT", `/assets/${w.a.assetId}`, {
      name: "Paquímetro revisado",
      externalId: "ERP-ASSET-1",
    });
    expect(updated.status).toBe(200);
    expect(dataOf(await jsonOf(updated)).externalId).toBe("ERP-ASSET-1");

    const [sibling] = await db
      .insert(asset)
      .values({
        unitId: w.a.unitId,
        customerId: w.a.customerId,
        labOrganizationId: w.a.orgId,
        assetTypeId: w.a.assetTypeId,
        name: "Segundo",
        serialNumber: "SN-2",
        tag: "TAG-SECOND",
      })
      .returning({ id: asset.id });
    if (!sibling) throw new Error("sibling asset not seeded");
    const before = await db
      .select({ id: assetAuditLog.id })
      .from(assetAuditLog)
      .where(eq(assetAuditLog.assetId, sibling.id));

    const collision = await send(w.keyA, "PUT", `/assets/${sibling.id}`, {
      tag: `TAG-${w.a.orgId}`,
    });
    expect(collision.status).toBe(409);
    const afterCollision = await db
      .select({ id: assetAuditLog.id })
      .from(assetAuditLog)
      .where(eq(assetAuditLog.assetId, sibling.id));
    expect(afterCollision).toEqual(before);

    const removed = await send(
      w.keyA,
      "DELETE",
      `/assets/${sibling.id}`,
      undefined,
      "del-sibling",
    );
    expect(removed.status).toBe(200);
    const [row] = await db
      .select({ deletedAt: asset.deletedAt })
      .from(asset)
      .where(eq(asset.id, sibling.id));
    expect(row?.deletedAt).not.toBeNull();

    const audit = await db
      .select({
        action: assetAuditLog.action,
        assetId: assetAuditLog.assetId,
        organizationId: assetAuditLog.organizationId,
      })
      .from(assetAuditLog);
    expect(
      audit.map((entry) => `${entry.action}:${entry.assetId}`).toSorted(),
    ).toEqual([`update:${w.a.assetId}`, `delete:${sibling.id}`].toSorted());
    expect(new Set(audit.map((entry) => entry.organizationId))).toEqual(
      new Set([w.a.orgId]),
    );
  });

  it("REQ-18H-PAPI-5: a webhook endpoint receives its laboratory's signed events and never another's", async () => {
    const w = await seedWorld();
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // Deliveries are queued for the worker; the subscriber is the stubbed fetch.
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    const restoreOutbound = routeOutboundThroughGlobalFetch();

    const subscribe = async (key: string, url: string, idem: string) => {
      const response = await send(
        key,
        "POST",
        "/webhooks",
        { name: "Integração ERP", targetUrl: url, events: ["request.created"] },
        idem,
      );
      expect(response.status).toBe(201);
      const body = await jsonOf(response);
      const secret: unknown = Reflect.get(body, "secret");
      if (typeof secret !== "string") throw new Error("no webhook secret");
      return { id: String(dataOf(body).id), secret };
    };
    const hookA = await subscribe(
      w.keyA,
      "https://erp-a.example.com/hook",
      "hook-a",
    );
    const hookB = await subscribe(
      w.keyB,
      "https://erp-b.example.com/hook",
      "hook-b",
    );

    // An event of laboratory B reaches B's endpoint only.
    expect((await createRequest(w.keyB, w.b, "b-request-hook")).status).toBe(
      201,
    );
    // Queued with the request, not sent inside it.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await drainWebhookQueue()).toBe(1);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://erp-b.example.com/hook",
    ]);

    // An event of laboratory A reaches A's endpoint only, signed with A's secret.
    fetchMock.mockClear();
    expect((await createRequest(w.keyA, w.a, "a-request-hook")).status).toBe(
      201,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await drainWebhookQueue()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://erp-a.example.com/hook");
    const sent = Object(init);
    const body = String(sent.body);
    const signature = Object(sent.headers)["x-calibra-signature"];
    expect(signature).toBe(
      createHmac("sha256", hookA.secret).update(body).digest("hex"),
    );

    // Delivery rows belong to the emitting laboratory.
    const deliveries = await db
      .select({
        organizationId: publicApiWebhookDelivery.organizationId,
        subscriptionId: publicApiWebhookDelivery.subscriptionId,
        status: publicApiWebhookDelivery.status,
      })
      .from(publicApiWebhookDelivery);
    expect(
      deliveries
        .map(
          (row) => `${row.organizationId}:${row.subscriptionId}:${row.status}`,
        )
        .toSorted(),
    ).toEqual(
      [
        `${w.a.orgId}:${hookA.id}:SUCCESS`,
        `${w.b.orgId}:${hookB.id}:SUCCESS`,
      ].toSorted(),
    );

    // B's key cannot list, test, edit, delete or replay A's endpoint.
    fetchMock.mockClear();
    const listedByB = listOf(
      await jsonOf(await send(w.keyB, "GET", "/webhooks")),
    );
    expect(listedByB.map((row) => row.id)).toEqual([hookB.id]);
    const deliveriesByB = await send(
      w.keyB,
      "GET",
      `/webhooks/${hookA.id}/deliveries`,
    );
    expect(listOf(await jsonOf(deliveriesByB))).toEqual([]);
    expect(
      (await send(w.keyB, "POST", `/webhooks/${hookA.id}/test`)).status,
    ).toBe(404);
    expect(
      (await send(w.keyB, "PATCH", `/webhooks/${hookA.id}`, { name: "Tomado" }))
        .status,
    ).toBe(404);
    expect(
      (
        await send(
          w.keyB,
          "DELETE",
          `/webhooks/${hookA.id}`,
          undefined,
          "del-hook",
        )
      ).status,
    ).toBe(404);
    const deliveriesOfA = listOf(
      await jsonOf(
        await send(w.keyA, "GET", `/webhooks/${hookA.id}/deliveries`),
      ),
    );
    expect(deliveriesOfA).toHaveLength(1);
    const deliveryId = String(deliveriesOfA[0]?.id);
    expect(
      (
        await send(
          w.keyB,
          "POST",
          `/webhooks/${hookA.id}/deliveries/${deliveryId}/replay`,
        )
      ).status,
    ).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    // A's own replay goes to A's endpoint.
    const replay = await send(
      w.keyA,
      "POST",
      `/webhooks/${hookA.id}/deliveries/${deliveryId}/replay`,
    );
    expect(replay.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await drainWebhookQueue()).toBe(1);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://erp-a.example.com/hook",
    ]);
    restoreOutbound();
  });

  it("REQ-A8-WH-1: a webhook cannot be pointed at a private address, and the deliveries endpoint returns only a short snippet of the subscriber's answer", async () => {
    const w = await seedWorld();
    for (const targetUrl of [
      "https://10.0.0.5/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://localhost/hook",
      "https://user:pass@erp.example.com/hook",
      "ftp://erp.example.com/hook",
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- independent refusals, order is irrelevant.
      const response = await send(
        w.keyA,
        "POST",
        "/webhooks",
        { name: "Integração ERP", targetUrl, events: ["request.created"] },
        `refused-${targetUrl}`,
      );
      expect(response.status, targetUrl).toBeGreaterThanOrEqual(400);
      expect(response.status, targetUrl).toBeLessThan(500);
    }
    expect(
      listOf(await jsonOf(await send(w.keyA, "GET", "/webhooks"))),
    ).toEqual([]);

    const created = await send(
      w.keyA,
      "POST",
      "/webhooks",
      {
        name: "Integração ERP",
        targetUrl: "https://erp-a.example.com/hook",
        events: ["request.created"],
      },
      "ok-hook",
    );
    expect(created.status).toBe(201);
    const hook = dataOf(await jsonOf(created));
    await db.insert(publicApiWebhookDelivery).values({
      id: "legacy-delivery",
      subscriptionId: String(hook.id),
      organizationId: w.a.orgId,
      eventId: "evt",
      eventType: "request.created",
      requestUrl: "https://erp-a.example.com/hook",
      requestBody: {},
      responseBody: "x".repeat(5000),
    });
    const [delivery] = listOf(
      await jsonOf(
        await send(w.keyA, "GET", `/webhooks/${hook.id}/deliveries`),
      ),
    );
    expect(String(delivery?.responseBody)).toHaveLength(512);
  });

  async function subscribe(
    key: string,
    name: string,
    url: string,
    events: string[],
  ) {
    const response = await send(
      key,
      "POST",
      "/webhooks",
      { name, targetUrl: url, events },
      `hook-${name}`,
    );
    expect(response.status).toBe(201);
    return String(dataOf(await jsonOf(response)).id);
  }

  it("REQ-A8-WH-2: switching a disabled subscription back to ACTIVE clears why it was disabled and its failure streak", async () => {
    const w = await seedWorld();
    const id = await subscribe(
      w.keyA,
      "Integração ERP",
      "https://erp-a.example.com/hook",
      ["request.created"],
    );
    await db
      .update(publicApiWebhookSubscription)
      .set({
        status: "INACTIVE",
        disabledAt: new Date(),
        disabledReason: "consecutive_failures",
        consecutiveFailures: 10,
      })
      .where(eq(publicApiWebhookSubscription.id, id));

    const listed = listOf(await jsonOf(await send(w.keyA, "GET", "/webhooks")));
    expect(listed[0]).toMatchObject({
      status: "INACTIVE",
      disabledReason: "consecutive_failures",
      consecutiveFailures: 10,
    });
    expect(listed[0]?.disabledAt).not.toBeNull();

    const patched = await send(w.keyA, "PATCH", `/webhooks/${id}`, {
      status: "ACTIVE",
    });
    expect(patched.status).toBe(200);
    expect(dataOf(await jsonOf(patched))).toMatchObject({
      status: "ACTIVE",
      disabledAt: null,
      disabledReason: null,
      consecutiveFailures: 0,
    });
    const [row] = await db
      .select()
      .from(publicApiWebhookSubscription)
      .where(eq(publicApiWebhookSubscription.id, id));
    expect(row).toMatchObject({
      status: "ACTIVE",
      disabledAt: null,
      disabledReason: null,
      consecutiveFailures: 0,
    });

    // Another edit of an active subscription leaves the counters alone.
    await db
      .update(publicApiWebhookSubscription)
      .set({ consecutiveFailures: 4 })
      .where(eq(publicApiWebhookSubscription.id, id));
    expect(
      (await send(w.keyA, "PATCH", `/webhooks/${id}`, { name: "Renomeado" }))
        .status,
    ).toBe(200);
    const [after] = await db
      .select()
      .from(publicApiWebhookSubscription)
      .where(eq(publicApiWebhookSubscription.id, id));
    expect(after?.consecutiveFailures).toBe(4);
  });

  it("REQ-A8-WH-3: a delivery can only be replayed to the subscription it belongs to, even within one laboratory", async () => {
    const w = await seedWorld();
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const restoreOutbound = routeOutboundThroughGlobalFetch();
    try {
      const first = await subscribe(
        w.keyA,
        "Primeiro",
        "https://erp-one.example.com/hook",
        ["request.created"],
      );
      const second = await subscribe(
        w.keyA,
        "Segundo",
        "https://erp-two.example.com/hook",
        ["customer.created"],
      );
      expect((await createRequest(w.keyA, w.a, "wh3-request")).status).toBe(
        201,
      );
      expect(await drainWebhookQueue()).toBe(1);
      fetchMock.mockClear();

      const [delivery] = listOf(
        await jsonOf(
          await send(w.keyA, "GET", `/webhooks/${first}/deliveries`),
        ),
      );
      const deliveryId = String(delivery?.id);
      const rowsBefore = await db.select().from(publicApiWebhookDelivery);
      const queueBefore = await db.select().from(appQueueJob);

      // The second subscription of the SAME laboratory cannot replay it.
      const crossed = await send(
        w.keyA,
        "POST",
        `/webhooks/${second}/deliveries/${deliveryId}/replay`,
      );
      expect(crossed.status).toBe(404);
      expect(await db.select().from(publicApiWebhookDelivery)).toHaveLength(
        rowsBefore.length,
      );
      expect(await db.select().from(appQueueJob)).toHaveLength(
        queueBefore.length,
      );
      expect(fetchMock).not.toHaveBeenCalled();

      // Its own subscription can.
      const own = await send(
        w.keyA,
        "POST",
        `/webhooks/${first}/deliveries/${deliveryId}/replay`,
      );
      expect(own.status).toBe(200);
      expect(await drainWebhookQueue()).toBe(1);
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
        "https://erp-one.example.com/hook",
      ]);
    } finally {
      restoreOutbound();
    }
  });

  it("REQ-A8-WH-4: an event raised in a rolled-back transaction stages nothing; a committed one stages its delivery row and its queue row together", async () => {
    const w = await seedWorld();
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    const id = await subscribe(
      w.keyA,
      "Integração ERP",
      "https://erp-a.example.com/hook",
      ["customer.created"],
    );
    const event = {
      organizationId: w.a.orgId,
      eventType: "customer.created" as const,
      payload: { id: 1 },
    };

    await expect(
      withPublicApiWebhookTransaction(w.a.orgId, async (_o, webhooks) => {
        await stagePublicApiWebhookEvent(webhooks, event);
        // Staged inside the transaction, then the mutation fails.
        throw new Error("the mutation failed");
      }),
    ).rejects.toThrow("the mutation failed");
    expect(await db.select().from(publicApiWebhookDelivery)).toHaveLength(0);
    expect(await db.select().from(appQueueJob)).toHaveLength(0);

    await withPublicApiWebhookTransaction(w.a.orgId, (_o, webhooks) =>
      stagePublicApiWebhookEvent(webhooks, event),
    );
    const deliveries = await db.select().from(publicApiWebhookDelivery);
    const queued = await db.select().from(appQueueJob);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      subscriptionId: id,
      status: "PENDING",
      organizationId: w.a.orgId,
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: "WEBHOOK_DELIVERY",
      status: "PENDING",
      maxAttempts: 5,
      payload: {
        type: "WEBHOOK_DELIVERY",
        deliveryId: deliveries[0]?.id,
        organizationId: w.a.orgId,
      },
    });
  });

  it("REQ-18H-PAPI-6: a request touches the last-use stamp of its own key only", async () => {
    const w = await seedWorld();

    expect((await send(w.keyA, "GET", "/units")).status).toBe(200);

    const stamps = await db
      .select({
        id: organizationApiKey.id,
        lastUsedAt: organizationApiKey.lastUsedAt,
      })
      .from(organizationApiKey);
    const byId = new Map(stamps.map((row) => [row.id, row.lastUsedAt]));
    expect(byId.get(w.keyAId)).toBeInstanceOf(Date);
    expect(byId.get(w.keyBId)).toBeNull();
  });
});
