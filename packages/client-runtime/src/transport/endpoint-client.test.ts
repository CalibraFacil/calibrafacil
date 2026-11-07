import {
  endpoint,
  ResponseContractError,
  type EndpointGroup,
} from "@calibra-facil/contracts";
import { buildCustomerRecord } from "@calibra-facil/contracts/customers-fixtures";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createCustomersApi } from "../modules/customers";
import {
  createCloudEndpointTransport,
  createDesktopEndpointTransport,
  endpointClient,
} from "./endpoint-client";
import { CalibraApiError } from "./errors";

const group = {
  list: endpoint({
    method: "get",
    path: "/api/things",
    query: z.object({
      page: z.coerce.number().default(1),
      query: z.string().optional(),
    }),
    response: z.object({ data: z.array(z.object({ id: z.number() })) }),
    failure: "Falha ao listar",
    policy: "local-first-read-through-sync",
  }),
  update: endpoint({
    method: "put",
    path: "/api/things/:id/parts/:partId",
    body: z.object({ name: z.string() }),
    response: z.object({ id: z.number() }),
    failure: "Falha ao atualizar",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
} as const satisfies EndpointGroup;

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(respond: () => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { calls, fetchImpl };
}

describe("cloud endpoint client", () => {
  it("sends a query as a query string, dropping undefined entries", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      Response.json({ data: [{ id: 1 }] }),
    );
    const client = endpointClient(
      group,
      createCloudEndpointTransport({
        baseUrl: "https://api.example.test/",
        fetch: fetchImpl,
        activeUnitProvider: () => "unit-9",
      }),
    );

    const result = await client.list({
      query: { page: 2, query: undefined },
    });

    expect(result).toEqual({ data: [{ id: 1 }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/api/things?page=2");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(new Headers(calls[0]?.init?.headers).get("x-active-unit-id")).toBe(
      "unit-9",
    );
  });

  it("fills and encodes path params and sends the body as JSON", async () => {
    const { calls, fetchImpl } = recordingFetch(() => Response.json({ id: 5 }));
    const client = endpointClient(
      group,
      createCloudEndpointTransport({
        baseUrl: "https://api.example.test",
        fetch: fetchImpl,
      }),
    );

    await client.update({
      params: { id: 5, partId: "a/b c" },
      body: { name: "novo" },
    });

    expect(calls[0]?.url).toBe(
      "https://api.example.test/api/things/5/parts/a%2Fb%20c",
    );
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "novo" }));
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("raises a CalibraApiError for a non-2xx answer: the body's error, status and code", async () => {
    const { fetchImpl } = recordingFetch(() =>
      Response.json(
        { error: "Cliente nao encontrado", code: "customer_not_found" },
        { status: 404 },
      ),
    );
    const client = endpointClient(
      group,
      createCloudEndpointTransport({
        baseUrl: "https://api.example.test",
        fetch: fetchImpl,
      }),
    );

    const failure = await client
      .update({ params: { id: 1, partId: "p" }, body: { name: "x" } })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
    expect(failure).toMatchObject({
      message: "Cliente nao encontrado",
      status: 404,
      code: "customer_not_found",
    });
  });

  it("falls back to the definition's failure message when the body has none", async () => {
    const { fetchImpl } = recordingFetch(
      () => new Response("", { status: 500 }),
    );
    const client = endpointClient(
      group,
      createCloudEndpointTransport({
        baseUrl: "https://api.example.test",
        fetch: fetchImpl,
      }),
    );

    await expect(client.list()).rejects.toMatchObject({
      message: "Falha ao listar",
      status: 500,
    });
  });

  it("parses a 2xx body with the response schema: strict throws, warn passes the body through", async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ data: "nope" }));
    const transport = createCloudEndpointTransport({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });

    await expect(
      endpointClient(group, transport).list(),
    ).rejects.toBeInstanceOf(ResponseContractError);

    const violations: string[] = [];
    const lenient = endpointClient(group, transport, {
      responseValidation: "warn",
      onResponseContractViolation: (violation) =>
        violations.push(violation.endpoint),
    });
    await expect(lenient.list()).resolves.toEqual({ data: "nope" });
    expect(violations).toEqual(["GET /api/things"]);
  });

  it("refuses a call that leaves out a path parameter", async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ id: 1 }));
    const client = endpointClient(
      group,
      createCloudEndpointTransport({
        baseUrl: "https://api.example.test",
        fetch: fetchImpl,
      }),
    );

    // @ts-expect-error -- `partId` is required by the path
    const call = client.update({ params: { id: 1 }, body: { name: "x" } });

    await expect(call).rejects.toThrow(/Missing path parameter "partId"/);
  });
});

describe("desktop endpoint transport", () => {
  it("calls the local server with the bearer token", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      Response.json({ data: [] }),
    );
    const client = endpointClient(
      group,
      createDesktopEndpointTransport({
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchImpl,
      }),
    );

    await client.list({ query: { page: 1 } });

    expect(calls[0]?.url).toBe("http://127.0.0.1:4317/api/things?page=1");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer local-token",
    );
    expect(calls[0]?.init?.credentials).toBe("include");
  });
});

describe("customers client", () => {
  function customersWith(respond: () => Response) {
    const { fetchImpl } = recordingFetch(respond);
    return createCustomersApi(
      createCloudEndpointTransport({
        baseUrl: "https://api.example.test",
        fetch: fetchImpl,
      }),
      {},
    );
  }

  const cnpjInput = { params: { cnpj: "12345678000190" } };

  it("resolves a CNPJ that is not in the registry (404) to null", async () => {
    const customers = customersWith(() =>
      Response.json({ error: "CNPJ nao encontrado" }, { status: 404 }),
    );

    await expect(customers.lookupCnpj(cnpjInput)).resolves.toBeNull();
  });

  it("still throws for an invalid CNPJ (422) and an unreachable registry (502)", async () => {
    for (const status of [422, 502]) {
      const customers = customersWith(() =>
        Response.json({ error: "falhou" }, { status }),
      );

      await expect(customers.lookupCnpj(cnpjInput)).rejects.toMatchObject({
        status,
      });
    }
  });

  it("returns the registry data of a found CNPJ", async () => {
    const found = {
      taxId: "12.345.678/0001-90",
      name: "Alfa Ltda",
      tradeName: null,
      email: null,
      phone: null,
      status: "ATIVA",
      address: {
        cep: null,
        street: null,
        number: null,
        complement: null,
        neighbourhood: null,
        city: null,
        state: null,
      },
    };
    const customers = customersWith(() => Response.json(found));

    await expect(customers.lookupCnpj(cnpjInput)).resolves.toEqual(found);
  });

  it("parses the customer a create answers with", async () => {
    const created = { ...buildCustomerRecord(), invitationId: null };
    const customers = customersWith(() =>
      Response.json(created, { status: 201 }),
    );

    await expect(
      customers.create({ body: { name: "Alfa Ltda" } }),
    ).resolves.toEqual(created);
  });
});
