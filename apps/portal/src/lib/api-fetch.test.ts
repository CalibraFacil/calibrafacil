import {
  portalOverviewResponseSchema,
  ResponseContractError,
} from "@calibra-facil/contracts";
import { buildPortalOverview } from "@calibra-facil/contracts/jobs-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { z } from "zod";

import {
  PortalApiError,
  fetchExternalJson,
  fetchPortalJson,
  fetchPortalResponse,
  jsonInit,
  readPortalJsonResult,
} from "./api-fetch";

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

describe("portal API helper (REQ-TC-3)", () => {
  const schema = z.object({ ok: z.literal(true) });

  it("REQ-TC-3: a JSON request carries the method, the header and the body", async () => {
    const fetchMock = stubFetch({ ok: true });

    await fetchPortalJson("/api/portal/x", schema, {
      errorMessage: "falhou",
      init: jsonInit("PUT", { a: 1 }),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe('{"a":1}');
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(init?.credentials).toBe("include");
  });

  it("REQ-TC-3: an HTTP error is a PortalApiError with the status and body; the server message wins only when asked", async () => {
    stubFetch({ error: "Já respondido" }, 409);

    const plain = await fetchPortalJson("/api/portal/x", schema, {
      errorMessage: "falhou",
    }).catch((error: unknown) => error);
    expect(plain).toBeInstanceOf(PortalApiError);
    expect(plain).toMatchObject({
      message: "falhou",
      status: 409,
      body: { error: "Já respondido" },
    });

    const preferred = await fetchPortalJson("/api/portal/x", schema, {
      errorMessage: "falhou",
      serverErrorMessage: true,
    }).catch((error: unknown) => error);
    expect(preferred).toMatchObject({ message: "Já respondido" });
  });

  it("REQ-TC-3: public endpoints go out without the session cookie", async () => {
    const fetchMock = stubFetch({ ok: true });

    await fetchPortalResponse("/api/verify/abc", { credentials: "omit" });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.credentials).toBe("omit");
  });

  it("REQ-TC-3: a malformed body is data for the public pages, never an exception", async () => {
    stubFetch({ ok: false });
    const response = await fetchPortalResponse("/api/verify/abc");

    const result = await readPortalJsonResult(response, schema);

    expect(result.success).toBe(false);
  });

  it("REQ-TC-3: an external lookup is best-effort: null on failure or a bad shape", async () => {
    stubFetch({ ok: true });
    expect(await fetchExternalJson("https://x.test/a", schema)).toEqual({
      ok: true,
    });

    stubFetch({ nope: 1 });
    expect(await fetchExternalJson("https://x.test/a", schema)).toBeNull();

    stubFetch({}, 500);
    expect(await fetchExternalJson("https://x.test/a", schema)).toBeNull();
  });
});
