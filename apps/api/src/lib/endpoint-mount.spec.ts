import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { endpoint, noContent, routeId } from "@calibra-facil/contracts";

import { mount } from "./endpoint-mount";

const itemSchema = z.object({ id: z.number(), name: z.string() });

const endpoints = {
  list: endpoint({
    method: "get",
    path: "/api/things",
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      query: z.string().optional(),
    }),
    response: z.object({ data: z.array(itemSchema), page: z.number() }),
    failure: "Falha ao listar",
    policy: "local-first-read-through-sync",
  }),
  create: endpoint({
    method: "post",
    path: "/api/things",
    body: z.object({ name: z.string().min(2) }),
    response: itemSchema,
    status: 201,
    failure: "Falha ao criar",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
  get: endpoint({
    method: "get",
    path: "/api/things/:id",
    response: itemSchema,
    failure: "Falha ao carregar",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
  getTyped: endpoint({
    method: "get",
    path: "/api/things/typed/:id",
    params: z.object({ id: routeId }),
    response: itemSchema,
    failure: "Falha ao carregar",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
  broken: endpoint({
    method: "get",
    path: "/api/things/:id/broken",
    response: itemSchema,
    failure: "Falha",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
  remove: endpoint({
    method: "delete",
    path: "/api/things/:id",
    response: noContent,
    status: 204,
    failure: "Falha ao remover",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
  teapot: endpoint({
    method: "get",
    path: "/api/things/:id/teapot",
    response: itemSchema,
    failure: "Falha",
    policy: "cloud-only",
    desktopLabel: "Coisas",
  }),
};

function buildRouter() {
  const calls: string[] = [];
  const guard = createMiddleware(async (c, next) => {
    calls.push("guard");
    if (c.req.header("x-deny")) return c.json({ error: "denied" }, 403);
    await next();
  });
  const router = new Hono();
  mount(router, "/api/things", endpoints.list, [guard], async (_c, input) => ({
    data: [{ id: 1, name: input.query.query ?? "all" }],
    page: input.query.page,
  }));
  mount(
    router,
    "/api/things",
    endpoints.create,
    [guard],
    async (_c, input) => ({
      id: 7,
      name: input.body.name,
    }),
  );
  mount(router, "/api/things", endpoints.getTyped, [], async (_c, input) => ({
    // A number already: the definition's `params` schema parsed it.
    id: input.params.id,
    name: "typed",
  }));
  mount(router, "/api/things", endpoints.get, [guard], async (_c, input) => ({
    id: Number(input.params.id),
    name: "thing",
  }));
  mount(router, "/api/things", endpoints.broken, [], async () =>
    // @ts-expect-error -- the handler drifts from its response schema on purpose
    ({ id: "not-a-number", name: "x" }),
  );
  mount(router, "/api/things", endpoints.remove, [], async () => undefined);
  mount(router, "/api/things", endpoints.teapot, [], async (c) =>
    c.json({ error: "bad gateway" }, 502),
  );
  // The router is mounted under its prefix, as route-mounts.ts does.
  return { router: new Hono().route("/api/things", router), calls };
}

describe("mount", () => {
  it("serves the definition's method and path, with the validated query typed", async () => {
    const { router, calls } = buildRouter();

    const response = await router.request("/api/things?page=3&query=abc");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: 1, name: "abc" }],
      page: 3,
    });
    expect(calls).toEqual(["guard"]);
  });

  it("answers a 204 without a body when the definition says so", async () => {
    const { router } = buildRouter();

    const response = await router.request("/api/things/7", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("applies the schema defaults of the query", async () => {
    const { router } = buildRouter();

    const body = await (await router.request("/api/things")).json();

    expect(body).toEqual({ data: [{ id: 1, name: "all" }], page: 1 });
  });

  it("answers the definition's success status and passes the body typed", async () => {
    const { router } = buildRouter();

    const response = await router.request("/api/things", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "novo" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 7, name: "novo" });
  });

  it("passes the path params", async () => {
    const { router } = buildRouter();

    const body = await (await router.request("/api/things/42")).json();

    expect(body).toEqual({ id: 42, name: "thing" });
  });

  it("parses the path params with the definition's params schema", async () => {
    const { router } = buildRouter();

    const ok = await router.request("/api/things/typed/42");
    expect(await ok.json()).toEqual({ id: 42, name: "typed" });
    expect((await router.request("/api/things/typed/abc")).status).toBe(400);
  });

  it("rejects an invalid query or body with 400 before the handler runs", async () => {
    const { router } = buildRouter();

    expect((await router.request("/api/things?page=0")).status).toBe(400);
    const invalidBody = await router.request("/api/things", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(invalidBody.status).toBe(400);
  });

  it("runs the middleware first", async () => {
    const { router } = buildRouter();

    const response = await router.request("/api/things", {
      headers: { "x-deny": "1" },
    });

    expect(response.status).toBe(403);
  });

  it("fails a success body that does not match the response schema (development and tests)", async () => {
    const { router } = buildRouter();

    const response = await router.request("/api/things/1/broken");

    expect(response.status).toBe(500);
  });

  it("lets a handler answer with a ready Response for a status the definition does not describe", async () => {
    const { router } = buildRouter();

    const response = await router.request("/api/things/1/teapot");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "bad gateway" });
  });

  it("refuses a definition whose path is outside the prefix", () => {
    expect(() =>
      mount(new Hono(), "/api/other", endpoints.list, [], async () => ({
        data: [],
        page: 1,
      })),
    ).toThrow(/cannot be mounted under \/api\/other/);
  });
});
