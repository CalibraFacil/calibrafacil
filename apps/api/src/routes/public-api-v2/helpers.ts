import type { ContentfulStatusCode } from "hono/utils/http-status";

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

export function generateUniqueSlug(name: string) {
  return `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function isContentfulStatus(status: number): status is ContentfulStatusCode {
  return (
    Number.isInteger(status) &&
    status >= 200 &&
    status <= 599 &&
    status !== 204 &&
    status !== 205 &&
    status !== 304
  );
}

/**
 * The status a stored response is replayed with. The record keeps the status the
 * request answered (a stored 404 or 409 replays as that refusal, not as a 200).
 * Anything that is not a valid response status falls back to 200.
 */
export function toIdempotencyResponseStatus(
  status: number,
): ContentfulStatusCode | 204 {
  if (status === 204) return 204;
  return isContentfulStatus(status) ? status : 200;
}
