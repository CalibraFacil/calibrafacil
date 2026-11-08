/**
 * REQ-WH-001/002/003: POST /webhooks/resend (Svix-signed Resend webhook) against
 * a real Postgres. The signature check, the dedup ledger (`email_webhook_event`,
 * UNIQUE by svix id) and the suppression list (`email_suppression`) all run for
 * real; each case reads the two tables back.
 *
 *  - REQ-WH-001: invalid signature -> 401; unset RESEND_WEBHOOK_SECRET -> 200 no-op.
 *  - REQ-WH-002: a redelivery of the same svix-id is deduped (no second apply), 200.
 *  - REQ-WH-003: email.complained -> suppress (all, complaint); email.bounced HARD
 *    -> suppress (all, hard_bounce); soft bounce / other events -> 200 no-op.
 *
 * The crypto itself is pinned to an independent oracle in
 * domains/notifications/resend-webhook.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@calibra-facil/db";
import { emailSuppression, emailWebhookEvent } from "@calibra-facil/db/schema";
import { truncateAll } from "../../../../test/integration/db";
import { webhooksRouter } from "./webhooks";

const SECRET = "whsec_dGVzdHNlY3JldA=="; // base64("testsecret")
const PREVIOUS_SECRET = process.env.RESEND_WEBHOOK_SECRET;

function sign(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return `v1,${sig}`;
}

function post(body: string, headers: Record<string, string>) {
  return webhooksRouter.request("/resend", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function postSigned(payload: unknown, id = "msg_1") {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  return post(body, {
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": sign(SECRET, id, ts, body),
  });
}

function suppressions() {
  return db
    .select({
      email: emailSuppression.email,
      scope: emailSuppression.scope,
      reason: emailSuppression.reason,
      source: emailSuppression.source,
    })
    .from(emailSuppression);
}

function ledger() {
  return db
    .select({
      svixId: emailWebhookEvent.svixId,
      eventType: emailWebhookEvent.eventType,
    })
    .from(emailWebhookEvent);
}

beforeEach(async () => {
  await truncateAll();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (PREVIOUS_SECRET === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = PREVIOUS_SECRET;
});

describe("REQ-WH-001: signature gating", () => {
  it("REQ-WH-001 rejects an invalid signature with 401 and writes nothing", async () => {
    const body = JSON.stringify({
      type: "email.complained",
      data: { to: ["x@lab.com"] },
    });
    const ts = Math.floor(Date.now() / 1000).toString();

    const res = await post(body, {
      "svix-id": "msg_bad",
      "svix-timestamp": ts,
      "svix-signature": "v1,not-a-valid-signature",
    });

    expect(res.status).toBe(401);
    expect(await suppressions()).toEqual([]);
    expect(await ledger()).toEqual([]);
  });

  it("REQ-WH-001 rejects a signature made with another secret", async () => {
    const body = JSON.stringify({
      type: "email.complained",
      data: { to: ["x@lab.com"] },
    });
    const ts = Math.floor(Date.now() / 1000).toString();

    const res = await post(body, {
      "svix-id": "msg_other",
      "svix-timestamp": ts,
      "svix-signature": sign("whsec_b3RoZXI=", "msg_other", ts, body),
    });

    expect(res.status).toBe(401);
    expect(await suppressions()).toEqual([]);
  });

  it("REQ-WH-001 no-ops with 200 when RESEND_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;

    const res = await postSigned({
      type: "email.complained",
      data: { to: ["x@lab.com"] },
    });

    expect(res.status).toBe(200);
    expect(await suppressions()).toEqual([]);
    expect(await ledger()).toEqual([]);
  });
});

describe("REQ-WH-003: event handling", () => {
  it("REQ-WH-003 email.complained suppresses every recipient at scope 'all'", async () => {
    const res = await postSigned({
      type: "email.complained",
      data: { to: ["angry@lab.com", "Other@Lab.com"] },
    });

    expect(res.status).toBe(200);
    expect(
      (await suppressions()).toSorted((a, b) => a.email.localeCompare(b.email)),
    ).toEqual([
      {
        email: "angry@lab.com",
        scope: "all",
        reason: "complaint",
        source: "resend_webhook",
      },
      {
        email: "other@lab.com",
        scope: "all",
        reason: "complaint",
        source: "resend_webhook",
      },
    ]);
    expect(await ledger()).toEqual([
      { svixId: "msg_1", eventType: "email.complained" },
    ]);
  });

  it("REQ-WH-003 email.bounced (Permanent) suppresses as a hard bounce", async () => {
    const res = await postSigned({
      type: "email.bounced",
      data: { to: ["dead@lab.com"], bounce: { type: "Permanent" } },
    });

    expect(res.status).toBe(200);
    expect(await suppressions()).toEqual([
      {
        email: "dead@lab.com",
        scope: "all",
        reason: "hard_bounce",
        source: "resend_webhook",
      },
    ]);
  });

  it("REQ-WH-003 email.bounced (Transient/soft) does NOT suppress", async () => {
    const res = await postSigned({
      type: "email.bounced",
      data: { to: ["busy@lab.com"], bounce: { type: "Transient" } },
    });

    expect(res.status).toBe(200);
    expect(await suppressions()).toEqual([]);
  });

  it("REQ-WH-003 an unrelated event type is a 200 no-op", async () => {
    const res = await postSigned({
      type: "email.delivered",
      data: { to: ["ok@lab.com"] },
    });

    expect(res.status).toBe(200);
    expect(await suppressions()).toEqual([]);
  });
});

describe("REQ-WH-002: idempotent by svix-id", () => {
  it("REQ-WH-002 a redelivered svix-id is deduped (200, no second apply)", async () => {
    const first = await postSigned(
      { type: "email.complained", data: { to: ["dup@lab.com"] } },
      "msg_dup",
    );
    // The same delivery id arrives again, naming a recipient it never named
    // before: the ledger already has the id, so nothing is applied.
    const second = await postSigned(
      {
        type: "email.complained",
        data: { to: ["dup@lab.com", "new@lab.com"] },
      },
      "msg_dup",
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });
    expect((await suppressions()).map((row) => row.email)).toEqual([
      "dup@lab.com",
    ]);
    expect(await ledger()).toHaveLength(1);
  });

  it("REQ-WH-002 two different svix-ids are both applied", async () => {
    await postSigned(
      { type: "email.complained", data: { to: ["a@lab.com"] } },
      "msg_a",
    );
    await postSigned(
      { type: "email.complained", data: { to: ["b@lab.com"] } },
      "msg_b",
    );

    expect(await suppressions()).toHaveLength(2);
    expect(await ledger()).toHaveLength(2);
  });
});
