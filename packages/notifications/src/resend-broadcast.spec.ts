/**
 * Marketing Broadcast send helper (issue #577 follow-up #4).
 *
 * The Resend Broadcasts REST contract is the ONLY thing this helper speaks, so
 * these tests pin it by fully mocking `fetch`:
 *   - REQ-BC-001: create POST body + that the returned id is surfaced;
 *   - REQ-BC-002 (SAFETY): draft by default — /send is NEVER hit unless
 *     `send: true`, and then create→send fire in order;
 *   - REQ-BC-003: missing unsubscribe token throws BEFORE any network call;
 *   - REQ-BC-004: missing api key / audience id throws BEFORE any network call;
 *   - REQ-BC-005: a non-2xx create/send response throws with status + body.
 */
import { describe, it, expect, vi } from "vitest";
import {
  sendMarketingBroadcast,
  type SendMarketingBroadcastEnv,
} from "./resend-broadcast";

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

const HTML_WITH_UNSUB =
  '<p>Olá</p><p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Cancelar inscrição</a></p>';

const baseEnv: SendMarketingBroadcastEnv = {
  RESEND_API_KEY: "re_test",
  RESEND_AUDIENCE_ID: "aud_1",
  RESEND_FROM_EMAIL: "CalibraFácil <novidades@calibrafacil.com>",
  RESEND_REPLY_TO_EMAIL: "contato@calibrafacil.com",
};

describe("sendMarketingBroadcast", () => {
  it("REQ-BC-001 posts the exact create body and surfaces the returned id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { object: "broadcast", id: "bc_123" }));

    const result = await sendMarketingBroadcast(
      baseEnv,
      {
        subject: "Novidade no CalibraFácil",
        previewText: "Resumo da novidade",
        name: "product-update-2026-06",
        html: HTML_WITH_UNSUB,
      },
      { fetchImpl },
    );

    expect(result).toEqual({ broadcastId: "bc_123", status: "draft" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const { url, init } = callAt(fetchImpl, 0);
    expect(url).toBe("https://api.resend.com/broadcasts");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      audience_id: "aud_1",
      from: "CalibraFácil <novidades@calibrafacil.com>",
      reply_to: "contato@calibrafacil.com",
      subject: "Novidade no CalibraFácil",
      preview_text: "Resumo da novidade",
      name: "product-update-2026-06",
      html: HTML_WITH_UNSUB,
    });
  });

  it("REQ-BC-001 falls back to the default from address when env has none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "bc_x" }));

    await sendMarketingBroadcast(
      { RESEND_API_KEY: "re_test", RESEND_AUDIENCE_ID: "aud_1" },
      { subject: "s", name: "n", html: HTML_WITH_UNSUB },
      { fetchImpl },
    );

    const body = JSON.parse(callAt(fetchImpl, 0).init.body);
    expect(body.from).toBe("CalibraFácil <no-reply@calibrafacil.com>");
    // reply_to defaults to the resolved from address when unset.
    expect(body.reply_to).toBe("CalibraFácil <no-reply@calibrafacil.com>");
  });

  it("REQ-BC-002 creates a DRAFT by default and NEVER calls /send", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { object: "broadcast", id: "bc_draft" }));

    const result = await sendMarketingBroadcast(
      baseEnv,
      { subject: "s", name: "n", html: HTML_WITH_UNSUB },
      { fetchImpl },
    );

    expect(result.status).toBe("draft");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(callAt(fetchImpl, 0).url).toBe("https://api.resend.com/broadcasts");
    for (const [calledUrl] of fetchImpl.mock.calls) {
      expect(String(calledUrl)).not.toContain("/send");
    }
  });

  it("REQ-BC-002 calls create then /send (in order) when send:true", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { object: "broadcast", id: "bc_9" }))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const result = await sendMarketingBroadcast(
      baseEnv,
      { subject: "s", name: "n", html: HTML_WITH_UNSUB, send: true },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(callAt(fetchImpl, 0).url).toBe("https://api.resend.com/broadcasts");
    expect(callAt(fetchImpl, 0).init.method).toBe("POST");

    const send = callAt(fetchImpl, 1);
    expect(send.url).toBe("https://api.resend.com/broadcasts/bc_9/send");
    expect(send.init.method).toBe("POST");
    expect(send.init.headers.Authorization).toBe("Bearer re_test");

    expect(result).toEqual({ broadcastId: "bc_9", status: "queued" });
  });

  it("REQ-BC-002 forwards scheduled_at and reports scheduled when scheduling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "bc_s" }))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const result = await sendMarketingBroadcast(
      baseEnv,
      {
        subject: "s",
        name: "n",
        html: HTML_WITH_UNSUB,
        send: true,
        scheduledAt: "2026-07-01T12:00:00Z",
      },
      { fetchImpl },
    );

    const send = callAt(fetchImpl, 1);
    expect(send.url).toBe("https://api.resend.com/broadcasts/bc_s/send");
    expect(JSON.parse(send.init.body)).toEqual({
      scheduled_at: "2026-07-01T12:00:00Z",
    });
    expect(result.status).toBe("scheduled");
  });

  it("REQ-BC-003 throws and makes NO network call when html lacks the unsubscribe token", async () => {
    const fetchImpl = vi.fn();

    const error = await sendMarketingBroadcast(
      baseEnv,
      { subject: "s", name: "n", html: "<p>sem link de cancelamento</p>" },
      { fetchImpl },
    ).catch((e: unknown) => e);

    if (!(error instanceof Error)) throw new Error("expected an Error");
    expect(error.message).toMatch(/unsubscribe/i);
    expect(error.message).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REQ-BC-004 throws when RESEND_API_KEY is blank, before any network call", async () => {
    const fetchImpl = vi.fn();

    const error = await sendMarketingBroadcast(
      { ...baseEnv, RESEND_API_KEY: "   " },
      { subject: "s", name: "n", html: HTML_WITH_UNSUB },
      { fetchImpl },
    ).catch((e: unknown) => e);

    if (!(error instanceof Error)) throw new Error("expected an Error");
    expect(error.message).toContain("RESEND_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REQ-BC-004 throws when RESEND_AUDIENCE_ID is missing, before any network call", async () => {
    const fetchImpl = vi.fn();

    const error = await sendMarketingBroadcast(
      { ...baseEnv, RESEND_AUDIENCE_ID: undefined },
      { subject: "s", name: "n", html: HTML_WITH_UNSUB },
      { fetchImpl },
    ).catch((e: unknown) => e);

    if (!(error instanceof Error)) throw new Error("expected an Error");
    expect(error.message).toContain("RESEND_AUDIENCE_ID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REQ-BC-005 surfaces a non-2xx CREATE response with status + body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { message: "audience not found" }));

    const error = await sendMarketingBroadcast(
      baseEnv,
      { subject: "s", name: "n", html: HTML_WITH_UNSUB },
      { fetchImpl },
    ).catch((e: unknown) => e);

    if (!(error instanceof Error)) throw new Error("expected an Error");
    expect(error.message).toContain("422");
    expect(error.message).toContain("audience not found");
  });

  it("REQ-BC-005 surfaces a non-2xx SEND response with status + body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "bc_e" }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "send failed" }));

    const error = await sendMarketingBroadcast(
      baseEnv,
      { subject: "s", name: "n", html: HTML_WITH_UNSUB, send: true },
      { fetchImpl },
    ).catch((e: unknown) => e);

    if (!(error instanceof Error)) throw new Error("expected an Error");
    expect(error.message).toContain("500");
    expect(error.message).toContain("send failed");
  });
});
