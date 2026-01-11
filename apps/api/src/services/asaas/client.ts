import type { AsaasEnvironment, AsaasErrorResponse } from "./types";

// =============================================================================
// ASAAS API CLIENT
// =============================================================================

const ASAAS_URLS: Record<AsaasEnvironment, string> = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  production: "https://api.asaas.com/v3",
};

/**
 * Custom error class for Asaas API errors
 */
export class AsaasError extends Error {
  public code: string;
  public details: AsaasErrorResponse;

  constructor(response: AsaasErrorResponse) {
    const message =
      response.errors?.[0]?.description || "Erro desconhecido na API Asaas";
    super(message);
    this.name = "AsaasError";
    this.code = response.errors?.[0]?.code || "UNKNOWN";
    this.details = response;
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
   * Make an HTTP request to the Asaas API
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

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CalibraFacil/1.0 (+https://calibrafacil.com)",
        access_token: this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle non-OK responses
    if (!response.ok) {
      let errorData: AsaasErrorResponse;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          errors: [
            {
              code: `HTTP_${response.status}`,
              description: response.statusText || "Erro de conexão com Asaas",
            },
          ],
        };
      }
      throw new AsaasError(errorData);
    }

    // Handle empty responses (e.g., DELETE)
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
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

    const environment =
      (process.env.ASAAS_ENVIRONMENT as AsaasEnvironment) || "sandbox";
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
