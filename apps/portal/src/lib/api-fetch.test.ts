import {
  portalOverviewResponseSchema,
  ResponseContractError,
} from "@calibra-facil/contracts";
import { buildPortalOverview } from "@calibra-facil/contracts/jobs-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPortalJson } from "./api-fetch";

const overview = buildPortalOverview();

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPortalJson", () => {
  it("REQ-TC-4: fetches the endpoint with the session cookie and returns the typed payload", async () => {
    const fetchMock = stubFetch(overview);

    const result = await fetchPortalJson(
      "/api/portal/overview",
      portalOverviewResponseSchema,
      { errorMessage: "Falha ao carregar o painel" },
    );

    // Typed by the schema: no cast to read a nested field.
    expect(result.equipment.attention[0]?.name).toBe("Balança A");
    expect(result).toEqual(overview);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/api\/portal\/overview$/);
    expect(init?.credentials).toBe("include");
  });

  it("REQ-TC-4: in strict mode (development) a response that breaks the schema throws a contract error", async () => {
    stubFetch({ ...overview, equipment: { total: "1" } });

    const failure = await fetchPortalJson(
      "/api/portal/overview",
      portalOverviewResponseSchema,
      {
        errorMessage: "Falha ao carregar o painel",
        responseValidation: "strict",
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ResponseContractError);
    if (failure instanceof ResponseContractError) {
      expect(failure.violation.endpoint).toBe("GET /api/portal/overview");
    }
  });

  it("REQ-TC-4: in warn mode (production) the mismatch is reported and the page keeps its data", async () => {
    const legacy = { ...overview, equipment: { total: "1" } };
    stubFetch(legacy);
    const onViolation = vi.fn();

    const result = await fetchPortalJson(
      "/api/portal/overview",
      portalOverviewResponseSchema,
      {
        errorMessage: "Falha ao carregar o painel",
        responseValidation: "warn",
        onResponseContractViolation: onViolation,
      },
    );

    expect(result).toEqual(legacy);
    expect(onViolation).toHaveBeenCalledTimes(1);
  });

  it("REQ-TC-4: an HTTP error is the caller's message, not a contract error", async () => {
    stubFetch({ error: "Erro interno" }, 500);

    await expect(
      fetchPortalJson("/api/portal/overview", portalOverviewResponseSchema, {
        errorMessage: "Falha ao carregar o painel",
      }),
    ).rejects.toThrow("Falha ao carregar o painel");
  });
});
