// Create + send a marketing Broadcast via the Resend Broadcasts REST API.
//
// This is the operator-triggered send mechanism for product-update
// announcements to the lab marketing audience (issue #577 follow-up #4). The
// Contacts sync (`resend-audience-sync.ts`) POPULATES that audience; this sends
// to it. The Broadcasts API post-dates the installed Resend SDK, so — like the
// Contacts client — we talk to it over raw `fetch` + snake_case JSON, keeping
// ALL HTTP here so callers never build a request and tests fully mock `fetch`
// against an explicit contract.
//
// SAFETY: this always creates a DRAFT first and only fires the send endpoint
// when `opts.send === true`. An accidental call therefore leaves a reviewable
// draft in the dashboard rather than blasting the live audience.

const RESEND_BASE_URL =
  process.env.RESEND_BASE_URL?.replace(/\/+$/, "") || "https://api.resend.com";

const DEFAULT_FROM_EMAIL = "CalibraFácil <no-reply@example.com>";

/**
 * Resend REQUIRES an unsubscribe link in broadcast HTML. This native token is
 * expanded by Resend per-recipient at send time. We fail fast if it's absent.
 */
const UNSUBSCRIBE_TOKEN = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export interface SendMarketingBroadcastEnv {
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
  /** Defaults to "CalibraFácil <no-reply@example.com>". */
  RESEND_FROM_EMAIL?: string;
  /** Defaults to the resolved `from` address. */
  RESEND_REPLY_TO_EMAIL?: string;
}

export interface SendMarketingBroadcastOptions {
  subject: string;
  previewText?: string;
  /** Internal label shown in the Resend dashboard (not customer-facing). */
  name: string;
  html: string;
  /**
   * SAFETY GATE. When falsy (default) the helper creates a DRAFT and never hits
   * the send endpoint. Only `true` actually sends.
   */
  send?: boolean;
  /** ISO-8601 instant; forwarded as `scheduled_at` to schedule the send. */
  scheduledAt?: string;
}

export interface SendMarketingBroadcastResult {
  broadcastId: string;
  /** "draft" | "queued" | "scheduled" depending on what was performed. */
  status: string;
}

export interface SendMarketingBroadcastDeps {
  /** Override `fetch` (tests mock the Resend HTTP contract here). */
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extract the broadcast id from a create response without `as` assertions. */
function parseBroadcastId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const id = payload.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

/**
 * Create (and optionally send) a marketing broadcast to the configured Resend
 * audience. Returns the broadcast id + the status that resulted from the action
 * performed (draft / queued / scheduled).
 */
export async function sendMarketingBroadcast(
  env: SendMarketingBroadcastEnv,
  opts: SendMarketingBroadcastOptions,
  deps: SendMarketingBroadcastDeps = {},
): Promise<SendMarketingBroadcastResult> {
  // REQ-BC-003: unsubscribe guard — fail BEFORE any network call. Resend
  // rejects broadcasts without an unsubscribe link, so this is a fast, helpful
  // local failure rather than a confusing remote 422.
  if (!opts.html.includes(UNSUBSCRIBE_TOKEN)) {
    throw new Error(
      `Marketing broadcast HTML is missing the required Resend unsubscribe token ${UNSUBSCRIBE_TOKEN}. ` +
        "Resend rejects broadcasts without an unsubscribe link — add the token to the template before sending.",
    );
  }

  // REQ-BC-004: config guard — fail BEFORE any network call. This helper is
  // invoked explicitly by an operator, so missing config is an error (unlike
  // the cron sync in #594, which silently no-ops).
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is required to create a marketing broadcast, but it is missing or blank.",
    );
  }
  const audienceId = env.RESEND_AUDIENCE_ID?.trim();
  if (!audienceId) {
    throw new Error(
      "RESEND_AUDIENCE_ID is required to create a marketing broadcast, but it is missing or blank.",
    );
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const from = env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
  const replyTo = env.RESEND_REPLY_TO_EMAIL?.trim() || from;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Create the DRAFT broadcast.
  const createBody = {
    audience_id: audienceId,
    from,
    reply_to: replyTo,
    subject: opts.subject,
    preview_text: opts.previewText ?? "",
    name: opts.name,
    html: opts.html,
  };
  const createResponse = await fetchImpl(`${RESEND_BASE_URL}/broadcasts`, {
    method: "POST",
    headers,
    body: JSON.stringify(createBody),
  });
  if (!createResponse.ok) {
    // REQ-BC-005: surface status + body so the operator sees what failed.
    throw new Error(
      `Resend broadcast create failed (HTTP ${createResponse.status}): ${await readErrorText(createResponse)}`,
    );
  }
  const broadcastId = parseBroadcastId(await createResponse.json());
  if (!broadcastId) {
    throw new Error(
      "Resend broadcast create succeeded but the response did not include a broadcast id.",
    );
  }

  // REQ-BC-002 (SAFETY): draft by default. Only fire the send endpoint when the
  // caller explicitly opts in with `send: true`.
  if (opts.send !== true) {
    return { broadcastId, status: "draft" };
  }

  const sendBody = opts.scheduledAt
    ? JSON.stringify({ scheduled_at: opts.scheduledAt })
    : undefined;
  const sendResponse = await fetchImpl(
    `${RESEND_BASE_URL}/broadcasts/${encodeURIComponent(broadcastId)}/send`,
    { method: "POST", headers, body: sendBody },
  );
  if (!sendResponse.ok) {
    // REQ-BC-005: surface status + body for the send leg too.
    throw new Error(
      `Resend broadcast send failed (HTTP ${sendResponse.status}): ${await readErrorText(sendResponse)}`,
    );
  }

  return {
    broadcastId,
    status: opts.scheduledAt ? "scheduled" : "queued",
  };
}
