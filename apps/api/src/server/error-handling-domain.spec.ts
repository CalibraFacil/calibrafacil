import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  DomainError,
  conflict,
  forbidden,
  invalid,
  notFound,
  unauthenticated,
  unprocessable,
} from "../lib/domain-errors";
import { applyErrorHandling, type ErrorHandlingDeps } from "./error-handling";
import type { Env } from "./env";

// REQ-DE-2: applyErrorHandling maps any thrown DomainError to
// { error, code, details? } with its status; only 5xx is a reported defect.

function makeDeps(): ErrorHandlingDeps {
  return { report: vi.fn(), flush: vi.fn(async () => {}) };
}

function makeApp(deps: ErrorHandlingDeps, thrown: () => never) {
  const app = new Hono<{ Bindings: Env }>();
  applyErrorHandling(app, deps);
  app.get("/boom", () => thrown());
  return app;
}

describe("applyErrorHandling + DomainError", () => {
  it.each([
    [400, invalid("invalid_request", "Entrada inválida")],
    [401, unauthenticated("unauthenticated", "Sessão expirada")],
    [403, forbidden("forbidden", "Sem permissão")],
    [404, notFound("job_not_found", "Job não encontrado")],
    [409, conflict("job_status_conflict", "Status mudou")],
    [422, unprocessable("unprocessable", "Não processável")],
  ] as const)(
    "REQ-DE-2: maps a thrown DomainError to status %i without reporting it",
    async (status, error) => {
      const deps = makeDeps();
      const app = makeApp(deps, () => {
        throw error;
      });

      const response = await app.request("/boom");

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: error.message,
        code: error.code,
      });
      expect(deps.report).not.toHaveBeenCalled();
      expect(deps.flush).not.toHaveBeenCalled();
    },
  );

  it("REQ-DE-2: includes JSON-safe details when present", async () => {
    const deps = makeDeps();
    const app = makeApp(deps, () => {
      throw conflict("concurrent_update", "Registro alterado", {
        details: { currentStatus: "REVIEW", attempts: 2, nested: { a: [1] } },
      });
    });

    const response = await app.request("/boom");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Registro alterado",
      code: "concurrent_update",
      details: { currentStatus: "REVIEW", attempts: 2, nested: { a: [1] } },
    });
  });

  it("REQ-DE-2: reports and flushes only when a DomainError carries a 5xx status", async () => {
    const deps = makeDeps();
    const app = makeApp(deps, () => {
      throw new DomainError({
        code: "conflict",
        status: 503,
        message: "Indisponível",
      });
    });

    const response = await app.request("/boom");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Indisponível",
      code: "conflict",
    });
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(deps.flush).toHaveBeenCalledTimes(1);
  });

  it("REQ-DE-2: keeps P0001 as a reported 409 record_immutable", async () => {
    const deps = makeDeps();
    const app = makeApp(deps, () => {
      throw new Error("Failed query", {
        cause: Object.assign(new Error("frozen"), { code: "P0001" }),
      });
    });

    const response = await app.request("/boom");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Registro emitido ou de auditoria não pode ser alterado",
      code: "record_immutable",
    });
    expect(deps.report).toHaveBeenCalledTimes(1);
  });

  it("REQ-DE-2: keeps HTTPException passthrough and the generic 500", async () => {
    const deps = makeDeps();
    const passthrough = makeApp(deps, () => {
      throw new HTTPException(404, { message: "não encontrado" });
    });
    expect((await passthrough.request("/boom")).status).toBe(404);
    expect(deps.report).not.toHaveBeenCalled();

    const generic = makeApp(deps, () => {
      throw new Error("kaboom");
    });
    const response = await generic.request("/boom");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Erro interno do servidor",
    });
    expect(deps.report).toHaveBeenCalledTimes(1);
  });
});
