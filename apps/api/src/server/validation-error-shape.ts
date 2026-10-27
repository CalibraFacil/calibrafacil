import type { Hono } from "hono";
import type { Env } from "./env";

/**
 * One error shape for a request that fails validation (roadmap 2 D2, review
 * 3.3). `zValidator` answers a failed parse with zod's own result
 * (`{ success: false, error: { name: "ZodError", ... } }`), so clients that read
 * `error` as the message got an object. Rewritten here, once, to the shape of
 * every other failure: `{ error, code: "invalid_request", details: { issues } }`.
 * The routes' validators stay as they are (their types feed the client's
 * AppType).
 */
export function applyValidationErrorShape(app: Hono<{ Bindings: Env }>) {
  app.use("*", async (c, next) => {
    await next();
    if (c.res.status !== 400) return;
    if (!c.res.headers.get("content-type")?.includes("application/json")) {
      return;
    }
    const body: unknown = await c.res
      .clone()
      .json()
      .catch(() => null);
    const issues = zodIssuesOf(body);
    if (!issues) return;
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(
      JSON.stringify({
        error: "Dados inválidos",
        code: "invalid_request",
        details: { issues },
      }),
      { status: 400, headers },
    );
  });
}

type Issue = { path: string; message: string };

/** The issues of a zod failure result, or null for any other body. */
export function zodIssuesOf(body: unknown): Issue[] | null {
  if (!isRecord(body) || body.success !== false) return null;
  const error = body.error;
  if (!isRecord(error)) return null;
  const raw = Array.isArray(error.issues)
    ? error.issues
    : typeof error.message === "string"
      ? parseIssues(error.message)
      : null;
  if (!raw) return null;
  return raw.flatMap((issue) =>
    isRecord(issue)
      ? [
          {
            path: Array.isArray(issue.path) ? issue.path.join(".") : "",
            message:
              typeof issue.message === "string" ? issue.message : "inválido",
          },
        ]
      : [],
  );
}

function parseIssues(message: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(message);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
