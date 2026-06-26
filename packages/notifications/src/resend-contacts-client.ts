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

function toRequestBody(input: ContactUpsertInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    email: input.email,
    unsubscribed: input.unsubscribed,
    properties: input.properties,
  };
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
  ): Promise<Response> {
    return fetchImpl(url, {
      method,
      headers,
      body: JSON.stringify(toRequestBody(input)),
    });
  }

  return {
    async upsertContact(input) {
      // Idempotent upsert: update-by-email first; only create when the contact
      // does not yet exist (PATCH 404 → POST).
      const updateResponse = await send(
        "PATCH",
        contactUrl(baseUrl, config.audienceId, input.email),
        input,
      );

      if (updateResponse.ok) {
        return { created: false };
      }

      if (updateResponse.status !== 404) {
        throw new Error(
          `Resend contact update failed (HTTP ${updateResponse.status}): ${await readErrorText(updateResponse)}`,
        );
      }

      const createResponse = await send(
        "POST",
        contactUrl(baseUrl, config.audienceId),
        input,
      );

      if (!createResponse.ok) {
        throw new Error(
          `Resend contact create failed (HTTP ${createResponse.status}): ${await readErrorText(createResponse)}`,
        );
      }

      return { created: true };
    },
  };
}
