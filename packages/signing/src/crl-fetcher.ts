/**
 * HTTP CRL fetcher for the injected `VerifyPdfOptions.fetchCrl` seam
 * (#646 fase b). Kept separate from verify.ts so the verifier itself stays
 * network-free; the API verify route and the worker precompute share this.
 *
 * ICP-Brasil LCRs are re-published on fixed schedules (hours), so a short
 * module-level TTL cache avoids hammering the CA on every public-page hit.
 * Failures return null — the verdict degrades to `revocationChecked: false`,
 * never an error and never a false REVOKED.
 */

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // ICP LCRs are typically well under 2 MB.
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;

interface CacheEntry {
  bytes: Uint8Array;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface CrlFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  cacheTtlMs?: number;
}

export function createCrlFetcher(
  options: CrlFetcherOptions = {},
): (url: string) => Promise<Uint8Array | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  return async (url: string): Promise<Uint8Array | null> => {
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && cached.expiresAt > now) {
      return cached.bytes;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) return null;

      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength === 0 || body.byteLength > maxBytes) return null;

      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
      cache.set(url, { bytes: body, expiresAt: now + cacheTtlMs });
      return body;
    } catch {
      return null;
    }
  };
}
