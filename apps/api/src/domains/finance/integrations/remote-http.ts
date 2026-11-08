import { toRecord } from "@calibra-facil/shared/record";
import {
  REMOTE_API_OUTBOUND_OPTIONS,
  createOutboundFetch,
  type OutboundFetch,
} from "@calibra-facil/shared/safe-outbound-fetch";

/**
 * The one way the integrations talk to a generic HTTP ERP: bearer headers, a
 * JSON-or-text call through the SSRF-safe fetch and the remote id of a
 * response. The base URL is whatever the laboratory configured, so every call
 * goes through `createOutboundFetch` (private addresses refused, pinned DNS,
 * bounded); a caller that needs another transport (a test) passes `fetchImpl`.
 */
export function buildAuthHeaders(secret: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

const outboundFetch = createOutboundFetch(REMOTE_API_OUTBOUND_OPTIONS);

export type RemoteJsonResult = {
  ok: boolean;
  status: number;
  data: unknown;
};

export async function callRemoteJson(
  url: string,
  init: RequestInit,
  fetchImpl: OutboundFetch = outboundFetch,
): Promise<RemoteJsonResult> {
  const response = await fetchImpl(url, init);
  const contentType = response.headers.get("content-type") ?? "";

  const data: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  return { ok: response.ok, status: response.status, data };
}

export function extractRemoteId(data: unknown): string | null {
  const record = toRecord(data);
  if (typeof record.remoteId === "string" && record.remoteId.trim()) {
    return record.remoteId;
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id;
  }
  if (typeof record.id === "number") {
    return String(record.id);
  }

  return null;
}
