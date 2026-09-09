import type { AsaasEnvironment, AsaasErrorResponse } from "./types";

// =============================================================================
// ASAAS API CLIENT
// =============================================================================

const ASAAS_URLS: Record<AsaasEnvironment, string> = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  production: "https://api.asaas.com/v3",
};

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

// HTTP status codes that should trigger a retry
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateBackoff(attempt: number): number {
  const exponentialDelay = INITIAL_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
}

/**
 * Methods it is safe to send twice.
 *
 * Asaas documents no idempotency key for charge creation, so a retried POST
 * that actually succeeded the first time — response lost to a timeout, a 502
 * from an intermediate proxy, a dropped socket — creates a SECOND real charge,
 * checkout or subscription for the same offer. A failed checkout the customer
 * can retry is recoverable; billing them twice is not, so non-idempotent calls
 * surface the error instead of being replayed.
 *
 * DELETE stays retryable: repeating it converges on the same end state.
 */
const REPLAYABLE_METHODS: ReadonlySet<string> = new Set(["GET", "DELETE"]);

/**
 * How long Asaas says to wait, when it says anything.
 *
 * Asaas publishes `RateLimit-Reset` (seconds until the window clears) and the
 * usual `Retry-After`. Our exponential backoff caps at five seconds, which is
 * shorter than a real rate window — retrying blind either hammers a limit that
 * has not reset or gives up on one that was about to. Honour the header when
 * present, and keep it bounded so a bad value cannot park a request forever.
 */
const MAX_HONOURED_RESET_MS = 60_000;

function retryDelayFromHeaders(headers: Headers): number | null {
  const raw =
    headers.get("retry-after") ??
    headers.get("ratelimit-reset") ??
    headers.get("x-ratelimit-reset");
  if (!raw) return null;

  const seconds = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  return Math.min(seconds * 1000, MAX_HONOURED_RESET_MS);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseAsaasEnvironment(value: unknown): AsaasEnvironment {
  return value === "production" || value === "sandbox" ? value : "sandbox";
}

/**
 * Custom error class for Asaas API errors
 */
export class AsaasError extends Error {
  public code: string;
  public details: AsaasErrorResponse;

  constructor(response: AsaasErrorResponse | null | undefined) {
    // Asaas does not always answer a failure with an { errors: [...] } body —
    // some rejections arrive with errors null, or with a different shape
    // entirely. Reading .errors off that threw a TypeError inside the error
    // path itself, which replaced the provider's real message with a crash in
    // the constructor and made every such failure look identical.
    const first = response?.errors?.[0];
    super(first?.description || "Erro desconhecido na API Asaas");
    this.name = "AsaasError";
    this.code = first?.code || "UNKNOWN";
    this.details = response ?? { errors: [] };
  }
}

/**
 * Asaas API Client
 *
 * Handles all HTTP communication with Asaas API.
 * Supports both sandbox and production environments.
 */
export class AsaasClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, environment: AsaasEnvironment = "sandbox") {
    this.baseUrl = ASAAS_URLS[environment];
    this.apiKey = apiKey;
  }

  /**
   * Make an HTTP request to the Asaas API with automatic retry on transient failures
   */
  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | undefined>,
  ): Promise<T> {
    // Build URL with query params
    let url = `${this.baseUrl}${path}`;
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const requestInit: RequestInit = {
          method,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "CalibraFacil/1.0 (+https://calibrafacil.com)",
            access_token: this.apiKey,
          },
        };
        if (body && method !== "GET") {
          requestInit.body = JSON.stringify(body);
        }
        const response = await fetch(url, requestInit);

        // Handle non-OK responses
        if (!response.ok) {
          // Check if this is a retryable error
          if (
            RETRYABLE_STATUS_CODES.has(response.status) &&
            REPLAYABLE_METHODS.has(method) &&
            attempt < MAX_RETRIES
          ) {
            const delay =
              retryDelayFromHeaders(response.headers) ??
              calculateBackoff(attempt);
            console.warn(
              `Asaas API returned ${response.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
            );
            await sleep(delay);
            continue;
          }

          let errorData: AsaasErrorResponse;
          try {
            const parsed: unknown = await response.json();
            const errors =
              parsed && typeof parsed === "object" && "errors" in parsed
                ? Reflect.get(parsed, "errors")
                : null;
            errorData = Array.isArray(errors)
              ? { errors }
              : {
                  errors: [
                    {
                      code: `HTTP_${response.status}`,
                      description: `Asaas respondeu ${response.status}: ${JSON.stringify(parsed).slice(0, 300)}`,
                    },
                  ],
                };
          } catch {
            errorData = {
              errors: [
                {
                  code: `HTTP_${response.status}`,
                  description:
                    response.statusText || "Erro de conexão com Asaas",
                },
              ],
            };
          }
          throw new AsaasError(errorData);
        }

        // Handle empty responses (e.g., DELETE)
        const text = await response.text();
        if (!text) {
          return JSON.parse("{}");
        }

        return JSON.parse(text);
      } catch (error) {
        lastError = toError(error);

        // Don't retry AsaasError (non-retryable API errors like validation)
        if (error instanceof AsaasError) {
          throw error;
        }

        // A network error on a write says nothing about whether Asaas already
        // accepted the charge — the response may simply have been lost on the
        // way back. Asaas has no idempotency key, so a replay would be a second
        // real charge. Surface the failure and let the caller reconcile.
        if (!REPLAYABLE_METHODS.has(method)) {
          throw lastError;
        }

        // Retry on network errors (TypeError from fetch) — but only where a
        // duplicate request cannot become a duplicate charge.
        if (attempt < MAX_RETRIES) {
          const delay = calculateBackoff(attempt);
          console.warn(
            `Asaas API request failed: ${lastError.message}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
          await sleep(delay);
          continue;
        }
      }
    }

    // All retries exhausted
    throw (
      lastError || new Error("Asaas API request failed after maximum retries")
    );
  }

  /**
   * GET request helper
   */
  async get<T>(
    path: string,
    queryParams?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, queryParams);
  }

  /**
   * POST request helper
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  /**
   * PUT request helper
   */
  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  /**
   * DELETE request helper
   */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}

// =============================================================================
// CLIENT FACTORY
// =============================================================================

let clientInstance: AsaasClient | null = null;

/**
 * Get the singleton Asaas client instance
 *
 * Uses environment variables:
 * - ASAAS_API_KEY: Your Asaas API key
 * - ASAAS_ENVIRONMENT: "sandbox" or "production" (defaults to "sandbox")
 */
export function getAsaasClient(): AsaasClient {
  if (!clientInstance) {
    const apiKey = process.env.ASAAS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ASAAS_API_KEY environment variable is required for billing operations",
      );
    }

    const environment = parseAsaasEnvironment(process.env.ASAAS_ENVIRONMENT);
    clientInstance = new AsaasClient(apiKey, environment);
  }

  return clientInstance;
}

/**
 * Reset the client instance (useful for testing)
 */
export function resetAsaasClient(): void {
  clientInstance = null;
}
