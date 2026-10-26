import { createHmac } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { processBackgroundJob } from "@calibra-facil/jobs-core";
import {
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import { encryptPassword } from "@calibra-facil/signing";
import { db, truncateAll } from "../test/integration/db";
import {
  TEST_INTEGRATIONS_MASTER_KEY,
  makeTestEnv,
} from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";

// Real-DB integration tier for the WEBHOOK_DELIVERY handler: a real HTTP
// listener on 127.0.0.1 plays the subscriber (the operator allow list names it,
// as a self-hosted lab would name an ERP on its LAN), the delivery and
// subscription rows are real, and the handler is driven the way the queue
// drives it (attempt n of 5).

const SECRET = "whsec_test_secret";
const EVENT_BODY = {
  id: "evt-1",
  type: "customer.created",
  occurredAt: "2026-10-01T12:00:00.000Z",
  data: { id: 7, name: "Cliente" },
};

type Seen = {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: string;
};

const servers: Server[] = [];
let seen: Seen[] = [];

async function listen(
  respond: (response: ServerResponse) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      respond(response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no TCP port");
  }
  return `http://127.0.0.1:${address.port}/hook`;
}

async function seedDelivery(params: {
  targetUrl: string;
  subscriptionStatus?: "ACTIVE" | "INACTIVE";
  consecutiveFailures?: number;
  replayOf?: boolean;
}) {
  const org = await seedOrg({ orgId: "org-W", userId: "user-W" });
  const { encryptedPassword, iv } = encryptPassword(
    SECRET,
    TEST_INTEGRATIONS_MASTER_KEY,
  );
  await db.insert(publicApiWebhookSubscription).values({
    id: "sub-1",
    organizationId: org.orgId,
    name: "ERP",
    targetUrl: params.targetUrl,
    events: ["customer.created"],
    status: params.subscriptionStatus ?? "ACTIVE",
    secretPrefix: SECRET.slice(0, 12),
    encryptedSecret: encryptedPassword,
    secretIv: iv,
    consecutiveFailures: params.consecutiveFailures ?? 0,
    createdBy: org.userId,
  });
  await db.insert(publicApiWebhookDelivery).values({
    id: "del-1",
    subscriptionId: "sub-1",
    organizationId: org.orgId,
    eventId: EVENT_BODY.id,
    eventType: "customer.created",
    requestUrl: params.targetUrl,
    requestBody: EVENT_BODY,
    replayOfDeliveryId: params.replayOf ? "del-0" : null,
  });
  return org;
}

function deliver(
  organizationId: string,
  delivery?: { attempt: number; maxAttempts: number },
) {
  return processBackgroundJob(
    makeTestEnv(),
    { type: "WEBHOOK_DELIVERY", deliveryId: "del-1", organizationId },
    delivery,
  );
}

async function deliveryRow() {
  const [row] = await db
    .select()
    .from(publicApiWebhookDelivery)
    .where(eq(publicApiWebhookDelivery.id, "del-1"));
  if (!row) throw new Error("delivery row missing");
  return row;
}

async function subscriptionRow() {
  const [row] = await db
    .select()
    .from(publicApiWebhookSubscription)
    .where(eq(publicApiWebhookSubscription.id, "sub-1"));
  if (!row) throw new Error("subscription row missing");
  return row;
}

beforeEach(async () => {
  await truncateAll();
  seen = [];
  vi.stubEnv("OUTBOUND_ALLOW_PRIVATE_HOSTS", "127.0.0.1");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("WEBHOOK_DELIVERY (worker real-DB integration)", () => {
  it("delivers the signed payload, records the attempt and keeps only a snippet of the answer", async () => {
    const url = await listen((response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("A".repeat(5000));
    });
    const org = await seedDelivery({ targetUrl: url, consecutiveFailures: 3 });

    await deliver(org.orgId, { attempt: 1, maxAttempts: 5 });

    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.method).toBe("POST");
    expect(call.headers["x-calibra-event-id"]).toBe("evt-1");
    expect(call.headers["x-calibra-event-type"]).toBe("customer.created");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["x-calibra-signature"]).toBe(
      createHmac("sha256", SECRET).update(call.body).digest("hex"),
    );
    expect(JSON.parse(call.body)).toEqual(EVENT_BODY);

    const row = await deliveryRow();
    expect(row.status).toBe("SUCCESS");
    expect(row.attemptCount).toBe(1);
    expect(row.responseStatus).toBe(200);
    expect(row.responseBody).toBe("A".repeat(512));
    expect(row.deliveredAt).not.toBeNull();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.attempts).toHaveLength(1);
    expect(row.attempts[0]).toMatchObject({
      attempt: 1,
      status: 200,
      error: null,
    });

    const subscription = await subscriptionRow();
    expect(subscription.consecutiveFailures).toBe(0);
    expect(subscription.lastSuccessAt).not.toBeNull();
  });

  it("asks the queue to retry a failed attempt, then gives up on the last one and counts it", async () => {
    const url = await listen((response) => {
      response.writeHead(500);
      response.end("internal secrets: db password is hunter2");
    });
    const org = await seedDelivery({ targetUrl: url });

    await expect(
      deliver(org.orgId, { attempt: 1, maxAttempts: 5 }),
    ).rejects.toThrow(/HTTP 500/);
    let row = await deliveryRow();
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(1);
    expect(row.lastError).toBe("HTTP 500");
    expect(row.nextAttemptAt).not.toBeNull();
    expect((await subscriptionRow()).consecutiveFailures).toBe(0);

    await expect(
      deliver(org.orgId, { attempt: 4, maxAttempts: 5 }),
    ).rejects.toThrow();
    // The final delivery records the failure and does not throw.
    await deliver(org.orgId, { attempt: 5, maxAttempts: 5 });
    row = await deliveryRow();
    expect(row.status).toBe("FAILED");
    expect(row.attemptCount).toBe(3);
    expect(row.failedAt).not.toBeNull();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.attempts.map((entry) => entry.attempt)).toEqual([1, 2, 3]);

    const subscription = await subscriptionRow();
    expect(subscription.consecutiveFailures).toBe(1);
    expect(subscription.lastFailureAt).not.toBeNull();
    expect(subscription.status).toBe("ACTIVE");
  });

  it("switches the subscription off, with the reason, after enough failed deliveries in a row", async () => {
    const url = await listen((response) => {
      response.writeHead(503);
      response.end();
    });
    const org = await seedDelivery({ targetUrl: url, consecutiveFailures: 9 });

    await deliver(org.orgId);

    const subscription = await subscriptionRow();
    expect(subscription.consecutiveFailures).toBe(10);
    expect(subscription.status).toBe("INACTIVE");
    expect(subscription.disabledReason).toBe("consecutive_failures");
    expect(subscription.disabledAt).not.toBeNull();
  });

  it("refuses a target that resolves to a private address, without calling it or retrying", async () => {
    const url = await listen((response) => response.end("secret"));
    vi.stubEnv("OUTBOUND_ALLOW_PRIVATE_HOSTS", "");
    const org = await seedDelivery({ targetUrl: url });

    // Not even a first attempt of five throws: a refused address cannot be fixed by retrying.
    await deliver(org.orgId, { attempt: 1, maxAttempts: 5 });

    expect(seen).toHaveLength(0);
    const row = await deliveryRow();
    expect(row.status).toBe("FAILED");
    expect(row.responseStatus).toBeNull();
    expect(row.responseBody).toBeNull();
    expect(row.lastError).toMatch(/não permitido/);
    expect((await subscriptionRow()).consecutiveFailures).toBe(1);
  });

  it("does not follow a redirect to another host", async () => {
    const internal = await listen((response) => response.end("internal"));
    const url = await listen((response) => {
      response.writeHead(302, { location: internal });
      response.end();
    });
    const org = await seedDelivery({ targetUrl: url });

    await deliver(org.orgId);

    expect(seen.map((call) => call.url)).toEqual(["/hook"]);
    const row = await deliveryRow();
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toBe("HTTP 302");
  });

  it("does not call a subscription that was switched off while the event waited", async () => {
    const url = await listen((response) => response.end("ok"));
    const org = await seedDelivery({
      targetUrl: url,
      subscriptionStatus: "INACTIVE",
    });

    await deliver(org.orgId, { attempt: 1, maxAttempts: 5 });

    expect(seen).toHaveLength(0);
    const row = await deliveryRow();
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/desativado/);
  });

  it("delivers a replay even to a switched-off subscription, and a failed replay does not count against it", async () => {
    const url = await listen((response) => {
      response.writeHead(500);
      response.end();
    });
    const org = await seedDelivery({
      targetUrl: url,
      subscriptionStatus: "INACTIVE",
      replayOf: true,
    });

    await deliver(org.orgId);

    expect(seen).toHaveLength(1);
    expect((await deliveryRow()).status).toBe("FAILED");
    const subscription = await subscriptionRow();
    expect(subscription.consecutiveFailures).toBe(0);
    expect(subscription.status).toBe("INACTIVE");
  });

  it("is a no-op for a delivery that already succeeded (a repeated message)", async () => {
    const url = await listen((response) => response.end("ok"));
    const org = await seedDelivery({ targetUrl: url });
    await deliver(org.orgId);
    await deliver(org.orgId);
    expect(seen).toHaveLength(1);
  });

  it("times out a subscriber that never answers instead of hanging", async () => {
    const url = await listen(() => {
      // never answers
    });
    vi.stubEnv("OUTBOUND_ALLOW_PRIVATE_HOSTS", "127.0.0.1");
    const org = await seedDelivery({ targetUrl: url });
    const started = Date.now();
    await deliver(org.orgId);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect((await deliveryRow()).lastError).toMatch(/Tempo esgotado/);
  }, 30_000);
});
