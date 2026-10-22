import {
  portalOverviewResponseSchema,
  ResponseContractError,
} from "@calibra-facil/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPortalJson } from "./api-fetch";

const overview = {
  equipment: {
    total: 1,
    overdue: 0,
    dueSoon: 1,
    scheduled: 0,
    unscheduled: 0,
    inLab: 0,
    attention: [
      {
        id: 1,
        publicId: "6f1c1d1e-0000-4000-8000-000000000001",
        name: "Balança A",
        tag: "EQ-A1",
        nextCalibrationDate: "2026-11-01T00:00:00.000Z",
        customerId: 4,
        customerName: "Customer A",
      },
    ],
  },
  certificates: {
    available: 1,
    recent: [
      {
        id: 7,
        jobId: "CAL-0007",
        approvedAt: "2026-05-20T10:00:00.000Z",
        assetName: "Balança A",
        assetTag: "EQ-A1",
        releaseStatus: "RELEASED",
        ready: true,
      },
    ],
  },
  requests: {
    total: 1,
    open: 1,
    rejected: 0,
    recent: [
      {
        id: 3,
        status: "PENDING",
        submittedAt: "2026-05-21T10:00:00.000Z",
        itemCount: 2,
      },
    ],
  },
  serviceOrders: {
    total: 0,
    inProgress: 0,
    awaitingQuoteApproval: 0,
    readyForPickup: 0,
    awaitingQuote: [],
    recent: [],
  },
};

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
