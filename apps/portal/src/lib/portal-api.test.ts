import {
  portalAssetEndpoints,
  ResponseContractError,
} from "@calibra-facil/contracts";
import {
  buildPortalFleetAssetsResponse,
  buildPortalOverview,
} from "@calibra-facil/contracts/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortalApiError } from "./api-fetch";
import { portalApi, portalEndpointUrl } from "./portal-api";

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url: String(url), init };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portalApi", () => {
  it("calls a definition's path with the session cookie and returns the typed body", async () => {
    const fetchMock = stubFetch(buildPortalOverview());

    const overview = await portalApi.dashboard.overview();

    const { url, init } = lastRequest(fetchMock);
    expect(url).toMatch(/\/api\/portal\/overview$/);
    expect(init?.credentials).toBe("include");
    expect(init?.method).toBeUndefined();
    expect(overview.equipment.attention[0]?.name).toBe("Balança A");
  });

  it("serialises the query and drops the keys that are undefined", async () => {
    const fetchMock = stubFetch(buildPortalFleetAssetsResponse());

    await portalApi.assets.list({
      query: {
        page: 2,
        limit: 20,
        query: undefined,
        ids: [3, 4],
        sortBy: "name",
      },
    });

    expect(new URL(lastRequest(fetchMock).url).search).toBe(
      "?page=2&limit=20&ids=3%2C4&sortBy=name",
    );
  });

  it("fills and encodes the path parameters", async () => {
    const fetchMock = stubFetch({ url: "https://x/y", filename: "c.pdf" });

    await portalApi.certificates.download({ params: { id: "JOB 1/2" } });

    expect(lastRequest(fetchMock).url).toMatch(
      /\/api\/portal\/certificates\/JOB%201%2F2\/download$/,
    );
  });

  it("sends a body as JSON with the definition's method", async () => {
    const fetchMock = stubFetch({
      id: 1,
      calibrationIntervalMonths: 12,
      nextCalibrationDate: null,
      intervalSetBy: "customer_confirmed",
    });

    await portalApi.assets.setInterval({
      params: { id: 1 },
      body: { intervalMonths: 12, rationale: "histórico estável" },
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toMatch(/\/api\/portal\/assets\/1\/interval$/);
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      intervalMonths: 12,
      rationale: "histórico estável",
    });
  });

  it("sends no body and no content type for a POST without one", async () => {
    const fetchMock = stubFetch({ count: 0 });

    await portalApi.notifications.markAllRead();

    const { init } = lastRequest(fetchMock);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it("fails with the definition's message, or the API's own when asked", async () => {
    stubFetch({ error: "Orçamento já decidido" }, 409);

    const fixed = await portalApi.dashboard.overview().catch((e: unknown) => e);
    expect(fixed).toBeInstanceOf(PortalApiError);
    expect(fixed).toMatchObject({
      message: "Falha ao carregar o painel",
      status: 409,
    });

    const own = await portalApi.dashboard
      .overview(undefined, { serverErrorMessage: true })
      .catch((e: unknown) => e);
    expect(own).toMatchObject({ message: "Orçamento já decidido" });
  });

  it("names the endpoint in a contract error", async () => {
    stubFetch({ equipment: { total: "1" } });

    const failure = await portalApi.dashboard
      .overview()
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ResponseContractError);
    expect(String(failure)).toContain("GET /api/portal/overview");
  });
});

describe("portalEndpointUrl", () => {
  it("is the API's address of a document link", () => {
    expect(
      portalEndpointUrl(portalAssetEndpoints.intervalInsightReport, {
        params: { id: 12 },
      }),
    ).toMatch(/\/api\/portal\/assets\/12\/interval-insight\/report$/);
  });
});
