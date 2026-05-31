import { describe, expect, it } from "vitest";

import { CalibraApiError } from "./errors";
import { readJsonResponse, readMutationResponse } from "./response";

describe("client-runtime response helpers", () => {
  it("returns typed JSON payloads for successful responses", async () => {
    const response = Response.json({ data: { id: 1 } });

    await expect(
      readJsonResponse<{ data: { id: number } }>(response, "Fallback"),
    ).resolves.toEqual({ data: { id: 1 } });
  });

  it("throws CalibraApiError with API error payloads", async () => {
    const response = Response.json(
      { error: "Mensagem da API" },
      { status: 422 },
    );

    await expect(readJsonResponse(response, "Fallback")).rejects.toMatchObject({
      name: CalibraApiError.name,
      message: "Mensagem da API",
      status: 422,
    });
  });

  it("can return diagnostics payloads for validation-style failures", async () => {
    const response = Response.json(
      { diagnostics: [{ message: "Fórmula inválida" }] },
      { status: 422 },
    );

    await expect(
      readJsonResponse(response, "Fallback", {
        allowDiagnosticsResponse: true,
      }),
    ).resolves.toEqual({
      diagnostics: [{ message: "Fórmula inválida" }],
    });
  });

  it("accepts empty successful mutation responses", async () => {
    const response = new Response(null, { status: 204 });

    await expect(
      readMutationResponse(response, "Fallback"),
    ).resolves.toBeNull();
  });
});
