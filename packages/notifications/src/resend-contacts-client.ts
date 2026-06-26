// Thin, version-independent client for the Resend Contacts REST API.
//
// The repo's only existing Resend call is `resend.emails.send` (via the SDK).
// The Contacts API (audiences, topics, properties) post-dates the installed SDK
// version, so we talk to it over raw `fetch` + snake_case JSON instead. Keeping
// ALL HTTP here means callers never construct a request and tests fully mock
// `fetch` against an explicit contract. If the live contract shifts (e.g. the
// audience moves out of the path), that change is a one-liner in `contactUrl`.

const DEFAULT_BASE_URL = "https://api.resend.com";

export type TopicSubscription = "opt_in" | "opt_out";

export interface ContactTopic {
  id: string;
  subscription: TopicSubscription;
}

export interface ContactUpsertInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** When true the contact is unsubscribed from the audience (suppressed). */
  unsubscribed: boolean;
  /** Free-form string→string metadata mirrored into Resend contact properties. */
  properties: Record<string, string>;
  /** Topic opt-in/opt-out states. Omitted entirely for unsubscribed contacts. */
  topics?: ContactTopic[];
}

export interface ContactUpsertResult {
  /** true when the contact had to be created (PATCH 404 → POST), else updated. */
  created: boolean;
  /**
   * true when Resend rejected the custom `properties` (422 "properties do not
   * exist") and the upsert was retried WITHOUT them — the contact (email +
   * unsubscribed + topics) still landed, only the metadata was dropped.
   */
  propertiesSkipped: boolean;
}

export interface ResendContactsClientConfig {
  apiKey: string;
  audienceId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ResendContactsClient {
  upsertContact(input: ContactUpsertInput): Promise<ContactUpsertResult>;
}

/**
 * Build the contact endpoint URL. The Resend Contacts API is audience-scoped,
 * so the audience id lives in the path. Centralised so a live-contract tweak
 * (path vs. body) is a single edit.
 */
export function contactUrl(
  baseUrl: string,
  audienceId: string,
  email?: string,
): string {
  const base = `${baseUrl}/audiences/${encodeURIComponent(audienceId)}/contacts`;
  return email ? `${base}/${encodeURIComponent(email.toLowerCase())}` : base;
}

interface ToRequestBodyOptions {
  /** Omit the custom `properties` field (used by the 422 fallback retry). */
  omitProperties?: boolean;
}

function toRequestBody(
  input: ContactUpsertInput,
  options: ToRequestBodyOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    email: input.email,
    unsubscribed: input.unsubscribed,
  };
  if (!options.omitProperties) {
    body.properties = input.properties;
  }
  if (input.firstName != null && input.firstName !== "") {
    body.first_name = input.firstName;
  }
  if (input.lastName != null && input.lastName !== "") {
    body.last_name = input.lastName;
  }
  if (input.topics && input.topics.length > 0) {
    body.topics = input.topics.map((topic) => ({
      id: topic.id,
      subscription: topic.subscription,
    }));
  }
  return body;
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True only for Resend's specific "unknown custom property" 422 — a
 * `validation_error` whose message mentions properties (e.g.
 * `{"statusCode":422,"message":"One or more properties do not exist","name":"validation_error"}`).
 * Deliberately narrow so OTHER 422 validation errors (bad email, etc.) are NOT
 * matched and keep failing exactly as before.
 */
function isUnknownPropertyError(rawBody: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const name = typeof parsed.name === "string" ? parsed.name : "";
  const message =
    typeof parsed.message === "string" ? parsed.message.toLowerCase() : "";
  return name === "validation_error" && message.includes("propert");
}

export function createResendContactsClient(
  config: ResendContactsClientConfig,
): ResendContactsClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  async function send(
    method: "PATCH" | "POST",
    url: string,
    input: ContactUpsertInput,
    options: ToRequestBodyOptions = {},
  ): Promise<Response> {
    return fetchImpl(url, {
      method,
      headers,
      body: JSON.stringify(toRequestBody(input, options)),
    });
  }

  return {
    async upsertContact(input) {
      let propertiesSkipped = false;

      /**
       * Send the request and, when Resend rejects the custom properties with a
       * 422, retry the SAME request ONCE without `properties` so the contact
       * still lands. Returns the resolved response plus the already-read error
       * body (so the caller never re-reads a consumed stream). A non-property
       * 422 — and any other non-2xx — is returned untouched to fail as before.
       */
      async function sendWithPropertyFallback(
        method: "PATCH" | "POST",
        url: string,
      ): Promise<{ response: Response; errorText: string | null }> {
        const response = await send(method, url, input);
        if (response.ok || response.status !== 422) {
          return { response, errorText: null };
        }
        const errorText = await readErrorText(response);
        if (!isUnknownPropertyError(errorText)) {
          return { response, errorText };
        }
        // Unknown-property 422: drop ONLY the metadata and retry once.
        propertiesSkipped = true;
        const retry = await send(method, url, input, { omitProperties: true });
        return {
          response: retry,
          errorText: retry.ok ? null : await readErrorText(retry),
        };
      }

      // Idempotent upsert: update-by-email first; only create when the contact
      // does not yet exist (PATCH 404 → POST).
      const update = await sendWithPropertyFallback(
        "PATCH",
        contactUrl(baseUrl, config.audienceId, input.email),
      );

      if (update.response.ok) {
        return { created: false, propertiesSkipped };
      }

      if (update.response.status !== 404) {
        throw new Error(
          `Resend contact update failed (HTTP ${update.response.status}): ${update.errorText ?? (await readErrorText(update.response))}`,
        );
      }

      const create = await sendWithPropertyFallback(
        "POST",
        contactUrl(baseUrl, config.audienceId),
      );

      if (!create.response.ok) {
        throw new Error(
          `Resend contact create failed (HTTP ${create.response.status}): ${create.errorText ?? (await readErrorText(create.response))}`,
        );
      }

      return { created: true, propertiesSkipped };
    },
  };
}
