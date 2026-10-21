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

  it("REQ-DE-4: surfaces the stable API error code on CalibraApiError.code", async () => {
    const response = Response.json(
      {
        error: "O status do job mudou durante a operacao.",
        code: "job_status_conflict",
        details: { currentStatus: "REVIEW" },
      },
      { status: 409 },
    );

    const error = await readJsonResponse(response, "Fallback").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CalibraApiError);
    expect(error).toMatchObject({
      message: "O status do job mudou durante a operacao.",
      status: 409,
      code: "job_status_conflict",
    });
  });

  it("REQ-DE-4: surfaces the code from mutation responses too", async () => {
    const response = Response.json(
      { error: "Registro emitido", code: "record_immutable" },
      { status: 409 },
    );

    const error = await readMutationResponse(response, "Fallback").catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      message: "Registro emitido",
      code: "record_immutable",
    });
  });

  it("REQ-DE-4: code is undefined when the body has none or an unknown one", async () => {
    const plain = await readJsonResponse(
      Response.json({ error: "Sem código" }, { status: 400 }),
      "Fallback",
    ).catch((caught: unknown) => caught);
    const unknown = await readJsonResponse(
      Response.json(
        { error: "Novo", code: "from_the_future" },
        { status: 400 },
      ),
      "Fallback",
    ).catch((caught: unknown) => caught);

    expect(plain).toMatchObject({ message: "Sem código" });
    expect(plain).toHaveProperty("code", undefined);
    expect(unknown).toMatchObject({ message: "Novo" });
    expect(unknown).toHaveProperty("code", undefined);
  });
});
