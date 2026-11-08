import { describe, expect, it } from "vitest";

import { CalibraApiError } from "./errors";
import { readJsonResponse } from "./response";

describe("client-runtime response helpers", () => {
  it("returns the JSON payload of a successful response", async () => {
    const response = Response.json({ data: { id: 1 } });

    await expect(readJsonResponse(response, "Fallback")).resolves.toEqual({
      data: { id: 1 },
    });
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
