import { HTTPException } from "hono/http-exception";
import { createLabAuth } from "@calibra-facil/auth";

// Shared backoffice helpers used by the backoffice parent router AND its
// extracted sub-routers (organizations, users). Lifted here verbatim — zero
// logic change — so the exact same env/auth-forwarding/payload-shaping behavior
// is used everywhere without a parent↔child import cycle (mirrors the existing
// `backoffice-platform-log` shared module).

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function getEnvValue(c: { env?: unknown }, key: string) {
  return recordFromUnknown(c.env)[key];
}

export function responseStatus(status: number) {
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
    case 422:
    case 500:
    case 503:
      return status;
    default:
      return 500;
  }
}

export function platformUserFromUnknown(value: unknown) {
  const candidate = recordFromUnknown(value);
  const nested = recordFromUnknown(candidate.user);
  const user = Object.keys(nested).length > 0 ? nested : candidate;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string"
  ) {
    throw new HTTPException(502, {
      message: "Backoffice auth returned an invalid user payload",
    });
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

export function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

export async function forwardLabAuthResponse(params: {
  c: {
    req: { raw: Request };
  };
  path: string;
  body?: Record<string, unknown>;
}) {
  const auth = createLabAuth();
  const url = new URL(params.c.req.raw.url);
  url.pathname = params.path;
  url.search = "";

  const headers = new Headers(params.c.req.raw.headers);

  if (params.body) {
    headers.set("content-type", "application/json");
  }

  return auth.handler(
    new Request(url.toString(), {
      method: "POST",
      headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
    }),
  );
}

export function resolveTrustedAppUrl(c: { env?: unknown }) {
  const configuredAppUrl =
    getEnvValue(c, "APP_URL") ?? process.env.APP_URL ?? process.env.WEB_URL;

  if (typeof configuredAppUrl === "string") {
    const trimmed = configuredAppUrl.trim().replace(/\/+$/, "");
    if (trimmed) return trimmed;
  }

  return process.env.NODE_ENV === "production"
    ? "https://calibrafacil.com"
    : "http://localhost:5173";
}
