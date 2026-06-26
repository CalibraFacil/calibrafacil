/**
 * REQ-HARD-001 — graceful degradation when Resend rejects custom properties.
 *
 * #594 upserts a `properties` object (account_type/role/lab_id/lab_name). If any
 * custom property has not been pre-defined in the Resend account, Resend rejects
 * the WHOLE contact with HTTP 422 + a body like
 *   {"statusCode":422,"message":"One or more properties do not exist","name":"validation_error"}
 * (and `POST /properties` is dashboard-only). Today that 422 drops the contact
 * entirely, so the email + topic opt-in are lost too. The client must retry the
 * SAME upsert once WITHOUT `properties` so the contact (email + unsubscribed +
 * topics) still lands, and surface `propertiesSkipped`.
 *
 * A 422 that is NOT about properties — and any other non-2xx — must still throw
 * exactly as before (no broadened error-swallowing).
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

const PROPERTY_422_BODY = {
  statusCode: 422,
  message: "One or more properties do not exist",
  name: "validation_error",
};

const baseInput: ContactUpsertInput = {
  email: "tech@lab.test",
  firstName: "Tech",
  lastName: "User",
  unsubscribed: false,
  properties: { account_type: "lab", role: "technician" },
  topics: [{ id: "topic-novidades", subscription: "opt_in" }],
};

describe("REQ-HARD-001: retry contact upsert without unknown properties", () => {
  it("REQ-HARD-001 PATCH 404 → POST 422(properties) → retries POST without properties and the contact lands", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" }))
      .mockResolvedValueOnce(jsonResponse(422, PROPERTY_422_BODY))
      .mockResolvedValueOnce(jsonResponse(201, { id: "contact_1" }));
    const client = createResendContactsClient({
      apiKey: "re_test",
      audienceId: "aud_1",
      fetchImpl,
    });

    const result = await client.upsertContact(baseInput);

    // Contact is counted as synced (created), and we flag the properties drop.
    expect(result.created).toBe(true);
    expect(result.propertiesSkipped).toBe(true);

    // PATCH (404) → POST (422 properties) → POST retry (201).
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(callAt(fetchImpl, 0).init.method).toBe("PATCH");
    expect(callAt(fetchImpl, 1).init.method).toBe("POST");

    const retry = callAt(fetchImpl, 2);
    expect(retry.init.method).toBe("POST");
    const retryBody = JSON.parse(retry.init.body);
    // The retry drops ONLY the custom properties...
    expect("properties" in retryBody).toBe(false);
    // ...but keeps email + unsubscribed + topics so the contact still lands.
    expect(retryBody.email).toBe("tech@lab.test");
    expect(retryBody.unsubscribed).toBe(false);
    expect(retryBody.topics).toEqual([
      { id: "topic-novidades", subscription: "opt_in" },
    ]);
  });

  it("REQ-HARD-001 a 422 that is NOT a properties error still throws (no silent retry)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        statusCode: 422,
        message: "Invalid `email` field",
        name: "validation_error",
      }),
    );
    const client = createResendContactsClient({
      apiKey: "re_test",
      audienceId: "aud_1",
      fetchImpl,
    });

    await expect(client.upsertContact(baseInput)).rejects.toThrow(/422/);
    // No properties-stripped retry for a non-property 422.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("REQ-HARD-001 happy path (PATCH 200) → no retry and propertiesSkipped is false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200));
    const client = createResendContactsClient({
      apiKey: "re_test",
      audienceId: "aud_1",
      fetchImpl,
    });

    const result = await client.upsertContact(baseInput);

    expect(result.created).toBe(false);
    expect(result.propertiesSkipped).toBe(false);
    // Exactly one network call: no fallback when nothing was rejected.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
