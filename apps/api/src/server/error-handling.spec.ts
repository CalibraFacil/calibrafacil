import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { applyErrorHandling, type ErrorHandlingDeps } from "./error-handling";
import type { Env } from "./env";

// Unit tier for the onError hook: uncaught route errors become a
// structured report + generic JSON 500; intentional HTTPExceptions pass
// through untouched. The reporter/flush are injected — no network, no env.

function makeApp(deps: ErrorHandlingDeps) {
  const app = new Hono<{ Bindings: Env }>();
  applyErrorHandling(app, deps);
  app.get("/api/jobs/:id", () => {
    throw new Error("db exploded: postgres://user:pass@host/db");
  });
  app.get("/api/nope", () => {
    throw new HTTPException(404, { message: "não encontrado" });
  });
  app.get("/api/ok", (c) => c.json({ ok: true }));
  return app;
}

function makeDeps(): ErrorHandlingDeps {
  return {
    report: vi.fn(),
    flush: vi.fn(async () => {}),
  };
}

describe("applyErrorHandling", () => {
  it("reports uncaught errors and returns a generic JSON 500", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const response = await app.request("/api/jobs/42");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Erro interno do servidor",
    });
    expect(deps.report).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(deps.report).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect(context).toMatchObject({
      surface: "api",
      tags: { method: "GET", path: "/api/jobs/:id" },
    });
    // The event must be flushed before the serverless function freezes.
    expect(deps.flush).toHaveBeenCalledTimes(1);
  });

  it("never leaks the underlying error message to the client", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const body = await (await app.request("/api/jobs/42")).text();

    expect(body).not.toContain("postgres://");
    expect(body).not.toContain("db exploded");
  });

  it("passes intentional HTTPExceptions through without reporting", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const response = await app.request("/api/nope");

    expect(response.status).toBe(404);
    expect(deps.report).not.toHaveBeenCalled();
    expect(deps.flush).not.toHaveBeenCalled();
  });

  it("leaves healthy requests untouched", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const response = await app.request("/api/ok");

    expect(response.status).toBe(200);
    expect(deps.report).not.toHaveBeenCalled();
  });
});
