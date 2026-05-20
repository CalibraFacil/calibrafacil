import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AsaasClient,
  AsaasError,
  getAsaasClient,
  resetAsaasClient,
} from "../client";
import {
  mockFetchResponse,
  mockFetch,
  mockFetchNetworkError,
  mockFetchWithRetries,
  createMockCustomer,
} from "../../../../test/utils/mocks";

describe("AsaasClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    resetAsaasClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("should use sandbox URL for sandbox environment", () => {
      const client = new AsaasClient("test-api-key", "sandbox");
      expect(client["baseUrl"]).toBe("https://sandbox.asaas.com/api/v3");
    });

    it("should use production URL for production environment", () => {
      const client = new AsaasClient("test-api-key", "production");
      expect(client["baseUrl"]).toBe("https://api.asaas.com/v3");
    });
  });

  describe("request", () => {
    it("should make successful GET request", async () => {
      const mockData = createMockCustomer();
      global.fetch = mockFetch(mockFetchResponse(mockData));

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.get<typeof mockData>("/customers/cus_123");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://sandbox.asaas.com/api/v3/customers/cus_123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            access_token: "test-api-key",
          }),
        }),
      );
    });

    it("should make successful POST request with body", async () => {
      const mockData = createMockCustomer();
      global.fetch = mockFetch(mockFetchResponse(mockData));

      const client = new AsaasClient("test-api-key", "sandbox");
      const body = { name: "Test", cpfCnpj: "12345678901" };
      const result = await client.post<typeof mockData>("/customers", body);

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://sandbox.asaas.com/api/v3/customers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    });

    it("should include query parameters in URL", async () => {
      global.fetch = mockFetch(mockFetchResponse({ data: [] }));

      const client = new AsaasClient("test-api-key", "sandbox");
      await client.get("/customers", {
        limit: 10,
        offset: 0,
        status: undefined,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://sandbox.asaas.com/api/v3/customers?limit=10&offset=0",
        expect.any(Object),
      );
    });

    it("should handle empty response body", async () => {
      const response = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
      } as Response;
      global.fetch = vi.fn().mockResolvedValue(response);

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.delete("/subscriptions/sub_123");

      expect(result).toEqual({});
    });
  });

  describe("retry logic", () => {
    it("should retry on 500 status and succeed", async () => {
      const mockData = createMockCustomer();
      global.fetch = mockFetchWithRetries(1, 500, mockData);

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.get<typeof mockData>("/customers/cus_123");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should retry on 502 status and succeed", async () => {
      const mockData = createMockCustomer();
      global.fetch = mockFetchWithRetries(1, 502, mockData);

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.get<typeof mockData>("/customers/cus_123");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should retry on 503 status and succeed", async () => {
      const mockData = createMockCustomer();
      global.fetch = mockFetchWithRetries(1, 503, mockData);

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.get<typeof mockData>("/customers/cus_123");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should retry on 429 (rate limit) and succeed", async () => {
      const mockData = createMockCustomer();
      global.fetch = mockFetchWithRetries(1, 429, mockData);

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.get<typeof mockData>("/customers/cus_123");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should NOT retry on 400 (validation error)", async () => {
      const errorResponse = {
        errors: [{ code: "invalid_value", description: "Invalid CPF/CNPJ" }],
      };
      global.fetch = mockFetch(mockFetchResponse(errorResponse, 400));

      const client = new AsaasClient("test-api-key", "sandbox");

      await expect(client.post("/customers", {})).rejects.toThrow(AsaasError);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry on 401 (unauthorized)", async () => {
      const errorResponse = {
        errors: [{ code: "unauthorized", description: "Invalid API key" }],
      };
      global.fetch = mockFetch(mockFetchResponse(errorResponse, 401));

      const client = new AsaasClient("test-api-key", "sandbox");

      await expect(client.get("/customers")).rejects.toThrow(AsaasError);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry on 404 (not found)", async () => {
      const errorResponse = {
        errors: [{ code: "not_found", description: "Customer not found" }],
      };
      global.fetch = mockFetch(mockFetchResponse(errorResponse, 404));

      const client = new AsaasClient("test-api-key", "sandbox");

      await expect(client.get("/customers/invalid")).rejects.toThrow(
        AsaasError,
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should exhaust retries and throw error", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockFetchResponse(
            { errors: [{ code: "server_error", description: "Server error" }] },
            500,
          ),
        );

      const client = new AsaasClient("test-api-key", "sandbox");

      await expect(client.get("/customers")).rejects.toThrow(AsaasError);
      // 1 initial + 3 retries = 4 calls
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it("should retry on network error and succeed", async () => {
      const mockData = createMockCustomer();
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new TypeError("Network error"));
        }
        return Promise.resolve(mockFetchResponse(mockData));
      });

      const client = new AsaasClient("test-api-key", "sandbox");
      const result = await client.get<typeof mockData>("/customers/cus_123");

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should exhaust retries on persistent network error", async () => {
      global.fetch = mockFetchNetworkError("Network error");

      const client = new AsaasClient("test-api-key", "sandbox");

      await expect(client.get("/customers")).rejects.toThrow("Network error");
      // 1 initial + 3 retries = 4 calls
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("error handling", () => {
    it("should throw AsaasError with error details", async () => {
      const errorResponse = {
        errors: [
          { code: "invalid_cpfCnpj", description: "CPF/CNPJ inválido" },
          { code: "invalid_email", description: "Email inválido" },
        ],
      };
      global.fetch = mockFetch(mockFetchResponse(errorResponse, 400));

      const client = new AsaasClient("test-api-key", "sandbox");

      try {
        await client.post("/customers", {});
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AsaasError);
        const asaasError = error as AsaasError;
        expect(asaasError.code).toBe("invalid_cpfCnpj");
        expect(asaasError.message).toBe("CPF/CNPJ inválido");
        expect(asaasError.details.errors).toHaveLength(2);
      }
    });

    it("should handle non-JSON error response", async () => {
      const response = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("Invalid JSON")),
      } as unknown as Response;

      // Mock to always return this error (simulates exhausted retries)
      global.fetch = vi.fn().mockResolvedValue(response);

      const client = new AsaasClient("test-api-key", "sandbox");

      try {
        await client.get("/customers");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AsaasError);
        const asaasError = error as AsaasError;
        expect(asaasError.code).toBe("HTTP_500");
      }
    });
  });

  describe("getAsaasClient singleton", () => {
    it("should throw error if ASAAS_API_KEY is not set", () => {
      const originalEnv = process.env.ASAAS_API_KEY;
      delete process.env.ASAAS_API_KEY;

      expect(() => getAsaasClient()).toThrow(
        "ASAAS_API_KEY environment variable is required for billing operations",
      );

      process.env.ASAAS_API_KEY = originalEnv;
    });

    it("should return same instance on multiple calls", () => {
      process.env.ASAAS_API_KEY = "test-key";
      process.env.ASAAS_ENVIRONMENT = "sandbox";

      const client1 = getAsaasClient();
      const client2 = getAsaasClient();

      expect(client1).toBe(client2);
    });

    it("should use sandbox environment by default", () => {
      process.env.ASAAS_API_KEY = "test-key";
      delete process.env.ASAAS_ENVIRONMENT;

      const client = getAsaasClient();

      expect(client["baseUrl"]).toBe("https://sandbox.asaas.com/api/v3");
    });

    it("should use production environment when specified", () => {
      process.env.ASAAS_API_KEY = "test-key";
      process.env.ASAAS_ENVIRONMENT = "production";

      resetAsaasClient();
      const client = getAsaasClient();

      expect(client["baseUrl"]).toBe("https://api.asaas.com/v3");
    });
  });
});

describe("AsaasError", () => {
  it("should extract first error code and message", () => {
    const error = new AsaasError({
      errors: [
        { code: "first_error", description: "First error message" },
        { code: "second_error", description: "Second error message" },
      ],
    });

    expect(error.code).toBe("first_error");
    expect(error.message).toBe("First error message");
    expect(error.details.errors).toHaveLength(2);
  });

  it("should use default values for empty errors", () => {
    const error = new AsaasError({ errors: [] });

    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("Erro desconhecido na API Asaas");
    expect(error.details.errors).toHaveLength(0);
  });

  it("should use default values for missing errors array", () => {
    const error = new AsaasError({});

    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("Erro desconhecido na API Asaas");
    expect(error.details.errors).toBeUndefined();
  });
});
