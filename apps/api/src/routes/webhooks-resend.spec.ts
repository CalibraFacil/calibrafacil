/**
 * REQ-WH-001/002/003: POST /webhooks/resend (Svix-signed Resend webhook).
 *
 *  - REQ-WH-001: invalid signature → 401; unset RESEND_WEBHOOK_SECRET → 200 no-op.
 *  - REQ-WH-002: redelivery of the same svix-id is deduped (no double-apply), 200.
 *  - REQ-WH-003: email.complained → suppress (all, complaint); email.bounced HARD
 *    → suppress (all, hard_bounce); soft bounce / other events → 200 no-op.
 *
 * The DB dedup ledger and the suppression helper are mocked; the REAL signature
 * lib runs end-to-end through the handler (the crypto itself is pinned to an
 * independent oracle in lib/resend-webhook.spec.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

const { dbMock, suppressEmailMock } = vi.hoisted(() => ({
  dbMock: { insert: vi.fn() },
  suppressEmailMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@calibra-facil/db", () => ({ db: dbMock }));
vi.mock("@calibra-facil/notifications", () => ({
  suppressEmail: suppressEmailMock,
}));

import { webhooksRouter } from "./webhooks";

const SECRET = "whsec_dGVzdHNlY3JldA=="; // base64("testsecret")
const PREVIOUS_SECRET = process.env.RESEND_WEBHOOK_SECRET;

// `returning()` resolves to the dedup-insert result: a row (first delivery) or
// [] (duplicate svix-id hit the UNIQUE constraint via onConflictDoNothing).
function mockDedupInsert(result: unknown[]): void {
  const chain = {
    values: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    returning: vi.fn().mockResolvedValue(result),
  };
  dbMock.insert.mockReturnValue(chain);
}

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

beforeEach(() => {
  vi.clearAllMocks();
  suppressEmailMock.mockResolvedValue(undefined);
  mockDedupInsert([{ id: 1 }]); // default: a fresh (non-duplicate) delivery
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (PREVIOUS_SECRET === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = PREVIOUS_SECRET;
});

describe("REQ-WH-001: signature gating", () => {
  it("REQ-WH-001 rejects an invalid signature with 401 and applies nothing", async () => {
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
    expect(suppressEmailMock).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("REQ-WH-001 no-ops with 200 when RESEND_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await postSigned({
      type: "email.complained",
      data: { to: ["x@lab.com"] },
    });

    expect(res.status).toBe(200);
    expect(suppressEmailMock).not.toHaveBeenCalled();
  });
});

describe("REQ-WH-003: event handling", () => {
  it("REQ-WH-003 email.complained suppresses the recipient at scope 'all'", async () => {
    const res = await postSigned({
      type: "email.complained",
      data: { to: ["angry@lab.com"] },
    });

    expect(res.status).toBe(200);
    expect(suppressEmailMock).toHaveBeenCalledTimes(1);
    expect(suppressEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "angry@lab.com",
        scope: "all",
        reason: "complaint",
        source: "resend_webhook",
      }),
    );
  });

  it("REQ-WH-003 email.bounced (Permanent) suppresses as a hard bounce", async () => {
    const res = await postSigned({
      type: "email.bounced",
      data: { to: ["dead@lab.com"], bounce: { type: "Permanent" } },
    });

    expect(res.status).toBe(200);
    expect(suppressEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "dead@lab.com",
        scope: "all",
        reason: "hard_bounce",
        source: "resend_webhook",
      }),
    );
  });

  it("REQ-WH-003 email.bounced (Transient/soft) does NOT suppress", async () => {
    const res = await postSigned({
      type: "email.bounced",
      data: { to: ["busy@lab.com"], bounce: { type: "Transient" } },
    });

    expect(res.status).toBe(200);
    expect(suppressEmailMock).not.toHaveBeenCalled();
  });

  it("REQ-WH-003 an unrelated event type is a 200 no-op", async () => {
    const res = await postSigned({
      type: "email.delivered",
      data: { to: ["ok@lab.com"] },
    });

    expect(res.status).toBe(200);
    expect(suppressEmailMock).not.toHaveBeenCalled();
  });
});

describe("REQ-WH-002: idempotent by svix-id", () => {
  it("REQ-WH-002 a redelivered svix-id is deduped (200, no second apply)", async () => {
    // Dedup ledger reports the row already existed → onConflictDoNothing returns [].
    mockDedupInsert([]);
    const res = await postSigned(
      { type: "email.complained", data: { to: ["dup@lab.com"] } },
      "msg_dup",
    );

    expect(res.status).toBe(200);
    expect(suppressEmailMock).not.toHaveBeenCalled();
  });
});
