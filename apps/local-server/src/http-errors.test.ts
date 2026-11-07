import { Hono } from "hono";
import {
  LocalDomainError,
  LocalNotFoundError,
  LocalUnprocessableError,
} from "@calibra-facil/local-db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleLocalServerError } from "./http-errors";

function appThatThrows(error: unknown) {
  const app = new Hono();
  app.onError(handleLocalServerError);
  app.get("/boom", () => {
    throw error;
  });
  return app;
}

describe("handleLocalServerError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers a domain refusal with 400 and its message", async () => {
    const response = await appThatThrows(
      new LocalDomainError("Tag ja esta em uso"),
    ).request("/boom");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Tag ja esta em uso",
    });
  });

  it("answers a missing record with 404", async () => {
    const response = await appThatThrows(
      new LocalNotFoundError("Ativo local nao encontrado"),
    ).request("/boom");

    expect(response.status).toBe(404);
  });

  it("answers a refused business rule with 422, its message and its diagnostics", async () => {
    const withDiagnostics = await appThatThrows(
      new LocalUnprocessableError("Execucao falhou", [{ severity: "error" }]),
    ).request("/boom");
    expect(withDiagnostics.status).toBe(422);
    await expect(withDiagnostics.json()).resolves.toEqual({
      error: "Execucao falhou",
      diagnostics: [{ severity: "error" }],
    });

    const plain = await appThatThrows(
      new LocalUnprocessableError(
        "Padrao Massa A esta com certificado vencido",
      ),
    ).request("/boom");
    expect(plain.status).toBe(422);
    await expect(plain.json()).resolves.toEqual({
      error: "Padrao Massa A esta com certificado vencido",
    });
  });

  it("answers a body that is not JSON with 400", async () => {
    const response = await appThatThrows(
      new SyntaxError("Unexpected token"),
    ).request("/boom");

    expect(response.status).toBe(400);
  });

  it("answers anything unexpected with 500 and a fixed message, logging the detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await appThatThrows(
      new Error("SQLITE_CONSTRAINT: UNIQUE failed: assets.tag"),
    ).request("/boom");

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("SQLITE");
    expect(log).toHaveBeenCalled();
  });
});
