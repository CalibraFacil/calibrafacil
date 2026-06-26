/**
 * REQ-SYNC-004 (idempotent upsert) at the transport layer.
 *
 * The Resend Contacts client is the ONE place that speaks HTTP, so these tests
 * pin the exact request contract by fully mocking `fetch`:
 *   - update-by-email first (PATCH .../contacts/{email});
 *   - on 404, create (POST .../contacts) — and report `created: true`;
 *   - on a 200 update, NO create POST follows — `created: false`;
 *   - a non-404 error response throws (so the caller can count the failure).
 */
import { describe, it, expect, vi } from "vitest";
import {
  createResendContactsClient,
  type ContactUpsertInput,
} from "./resend-contacts-client";

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Guarded read of the nth recorded fetch call (noUncheckedIndexedAccess). */
function callAt(fetchImpl: ReturnType<typeof vi.fn>, n: number) {
  const call = fetchImpl.mock.calls[n];
  if (!call) throw new Error(`expected fetch call #${n}`);
  const [url, init] = call;
  return { url: String(url), init };
}

const baseInput: ContactUpsertInput = {
  email: "tech@lab.test",
  firstName: "Tech",
  lastName: "User",
  unsubscribed: false,
  properties: { account_type: "lab" },
  topics: [{ id: "topic-novidades", subscription: "opt_in" }],
};

describe("REQ-SYNC-004: Resend contacts client idempotent upsert", () => {
  it("REQ-SYNC-004 updates existing contacts with a single PATCH (no create)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200));
    const client = createResendContactsClient({
      apiKey: "re_test",
      audienceId: "aud_1",
      fetchImpl,
    });

    const result = await client.upsertContact(baseInput);

    expect(result.created).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = callAt(fetchImpl, 0);
    expect(init.method).toBe("PATCH");
    expect(url).toContain("aud_1");
    expect(url).toContain(encodeURIComponent("tech@lab.test"));
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body.email).toBe("tech@lab.test");
    expect(body.unsubscribed).toBe(false);
  });

  it("REQ-SYNC-004 creates via POST when the PATCH returns 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" }))
      .mockResolvedValueOnce(jsonResponse(201, { id: "contact_1" }));
    const client = createResendContactsClient({
      apiKey: "re_test",
      audienceId: "aud_1",
      fetchImpl,
    });

    const result = await client.upsertContact(baseInput);

    expect(result.created).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(callAt(fetchImpl, 0).init.method).toBe("PATCH");
    const create = callAt(fetchImpl, 1);
    expect(create.init.method).toBe("POST");
    // create POSTs to the collection endpoint (no email in the path).
    expect(create.url.endsWith("/contacts")).toBe(true);
  });

  it("REQ-SYNC-004 throws on a non-404 error so the caller can count it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const client = createResendContactsClient({
      apiKey: "re_test",
      audienceId: "aud_1",
      fetchImpl,
    });

    await expect(client.upsertContact(baseInput)).rejects.toThrow(/500/);
    // No create attempt after a hard error.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
