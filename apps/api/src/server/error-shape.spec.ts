import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyErrorHandling } from "./error-handling";
import { applyValidationErrorShape } from "./validation-error-shape";
import type { Env } from "./env";

function app() {
  const hono = new Hono<{ Bindings: Env }>();
  applyErrorHandling(hono, { report: () => {}, flush: async () => {} });
  applyValidationErrorShape(hono);
  hono.post(
    "/api/things",
    zValidator("json", z.object({ name: z.string().min(3), qty: z.number() })),
    (c) => c.json({ ok: true }),
  );
  hono.get("/api/locked", () => {
    throw new HTTPException(403, { message: "Sem permissão" });
  });
  hono.get("/api/bare", () => {
    throw new HTTPException(401);
  });
  hono.get("/api/custom", () => {
    throw new HTTPException(401, {
      res: new Response("challenge", { status: 401 }),
    });
  });
  return hono;
}

describe("one error shape (roadmap 2 D2)", () => {
  it("a validation failure answers { error, code: invalid_request, details.issues }", async () => {
    const res = await app().request("/api/things", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ab" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "Dados inválidos",
      code: "invalid_request",
    });
    expect(
      body.details.issues.map((issue: { path: string }) => issue.path),
    ).toEqual(expect.arrayContaining(["name", "qty"]));
  });

  it("a valid request is untouched", async () => {
    const res = await app().request("/api/things", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "abc", qty: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("an HTTPException without a body of its own answers JSON with a code, never plain text", async () => {
    const locked = await app().request("/api/locked");
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual({
      error: "Sem permissão",
      code: "forbidden",
    });

    const bare = await app().request("/api/bare");
    expect(bare.status).toBe(401);
    expect(await bare.json()).toEqual({
      error: "Não autenticado",
      code: "unauthenticated",
    });
  });

  it("an HTTPException that carries its own response keeps it", async () => {
    const res = await app().request("/api/custom");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("challenge");
  });
});
