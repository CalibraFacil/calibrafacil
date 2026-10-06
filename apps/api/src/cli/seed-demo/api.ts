/**
 * In-process client for the demo seed: it calls the real Hono app (the very
 * routes the web app uses) with a genuine Better Auth session cookie, so every
 * row the seed writes through it gets the same validation, numbering, audit
 * trail and snapshots as a row created in the UI.
 *
 * Sessions are written straight to the `session` table (signed the way Better
 * Auth signs its cookie) and removed again when the seed finishes.
 */
import { createHmac, randomBytes } from "node:crypto";
import { db } from "@calibra-facil/db";
import { session } from "@calibra-facil/db/schema";
import { inArray } from "drizzle-orm";

import { createApiApp } from "../../app";

export const LAB_ID = "demo-lab";

export const DEMO_ACTORS = {
  owner: { userId: "demo-admin", cookiePrefix: "lab" },
  reviewer: { userId: "demo-reviewer", cookiePrefix: "lab" },
  technician: { userId: "demo-technician", cookiePrefix: "lab" },
} as const;

export type Actor = keyof typeof DEMO_ACTORS;

export type ApiResult = {
  status: number;
  ok: boolean;
  body: unknown;
};

export class SeedApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(method: string, path: string, result: ApiResult) {
    super(
      `${method} ${path} -> ${result.status} ${JSON.stringify(result.body).slice(0, 600)}`,
    );
    this.name = "SeedApiError";
    this.status = result.status;
    this.body = result.body;
  }
}

function signedCookie(prefix: string, token: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `${prefix}.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

function runtimeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export type SeedApi = {
  request(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult>;
  /** Like `request`, but throws a `SeedApiError` unless the response is 2xx. */
  call(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown>;
  /**
   * A call made as a customer's portal user (separate Better Auth instance,
   * `portal` cookie), e.g. to file a calibration request.
   */
  portalCall(
    portal: { userId: string; organizationId: string },
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown>;
  /** Multipart upload (e.g. a PDF) with the same session handling. */
  upload(
    actor: Actor,
    path: string,
    form: FormData,
    method?: string,
  ): Promise<unknown>;
  close(): Promise<void>;
};

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function createSeedApi(): Promise<SeedApi> {
  const app = createApiApp();
  const env = runtimeEnv();
  const cookies = new Map<Actor, string>();
  const tokens: string[] = [];

  for (const [actor, { userId, cookiePrefix }] of Object.entries(DEMO_ACTORS)) {
    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    await db.insert(session).values({
      id: randomBytes(12).toString("hex"),
      token,
      userId,
      activeOrganizationId: LAB_ID,
      expiresAt: new Date(now.getTime() + 6 * 3600_000),
      createdAt: now,
      updatedAt: now,
    });
    tokens.push(token);
    if (actor === "owner" || actor === "reviewer" || actor === "technician") {
      cookies.set(actor, signedCookie(cookiePrefix, token));
    }
  }

  const portalCookies = new Map<string, string>();
  const portalCookie = async (userId: string, organizationId: string) => {
    const key = `${userId}@${organizationId}`;
    const known = portalCookies.get(key);
    if (known) return known;
    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    await db.insert(session).values({
      id: randomBytes(12).toString("hex"),
      token,
      userId,
      activeOrganizationId: organizationId,
      expiresAt: new Date(now.getTime() + 6 * 3600_000),
      createdAt: now,
      updatedAt: now,
    });
    tokens.push(token);
    const cookie = signedCookie("portal", token);
    portalCookies.set(key, cookie);
    return cookie;
  };

  const send = async (
    actor: Actor | { cookie: string },
    method: string,
    path: string,
    body: BodyInit | undefined,
    contentType: string | undefined,
  ): Promise<ApiResult> => {
    const cookie =
      typeof actor === "string" ? cookies.get(actor) : actor.cookie;
    if (!cookie) throw new Error(`No session for ${String(actor)}`);
    const headers: Record<string, string> = {
      cookie,
      origin: process.env.APP_URL ?? "http://localhost:5173",
    };
    if (contentType) headers["content-type"] = contentType;
    const response = await app.request(path, { method, headers, body }, env);
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      body: await parseBody(response),
    };
  };

  const request: SeedApi["request"] = (actor, method, path, body) =>
    send(
      actor,
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? undefined : "application/json",
    );

  return {
    request,
    async call(actor, method, path, body) {
      const result = await request(actor, method, path, body);
      if (!result.ok) throw new SeedApiError(method, path, result);
      return result.body;
    },
    async portalCall(portal, method, path, body) {
      const cookie = await portalCookie(portal.userId, portal.organizationId);
      const result = await send(
        { cookie },
        method,
        path,
        body === undefined ? undefined : JSON.stringify(body),
        body === undefined ? undefined : "application/json",
      );
      if (!result.ok) throw new SeedApiError(method, path, result);
      return result.body;
    },
    async upload(actor, path, form, method = "POST") {
      const result = await send(actor, method, path, form, undefined);
      if (!result.ok) throw new SeedApiError(method, path, result);
      return result.body;
    },
    async close() {
      if (tokens.length > 0) {
        await db.delete(session).where(inArray(session.token, tokens));
      }
    },
  };
}

// --- narrow readers for untyped JSON (no `as` assertions) -------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordOf(
  value: unknown,
  what: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what}: expected an object`);
  return value;
}

export function numberField(value: unknown, key: string): number {
  const field = recordOf(value, key)[key];
  if (typeof field !== "number") {
    throw new Error(
      `Expected numeric "${key}" in ${JSON.stringify(value).slice(0, 200)}`,
    );
  }
  return field;
}

export function stringField(value: unknown, key: string): string {
  const field = recordOf(value, key)[key];
  if (typeof field !== "string") {
    throw new Error(
      `Expected string "${key}" in ${JSON.stringify(value).slice(0, 200)}`,
    );
  }
  return field;
}
