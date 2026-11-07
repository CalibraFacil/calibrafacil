import { Buffer } from "node:buffer";
import { session as electronSession } from "electron";
import {
  desktopAuthFetchRequestSchema,
  desktopAuthFetchResponseSchema,
  type DesktopAuthFetchRequest,
  type DesktopAuthFetchResponse,
} from "@calibra-facil/contracts";
import type { DesktopEnvironment } from "./desktop-environment";
import { parseSetCookie, readSetCookieHeaders } from "./set-cookie";

/**
 * The cloud request the web app cannot make itself: a `fetch` from the main
 * process, with the session cookie jar attached and an `Origin` the cloud API
 * accepts. Only `/api/` paths on the configured origins are reachable.
 */
export function createDesktopAuthFetch(
  environment: Pick<
    DesktopEnvironment,
    "allowedCloudApiOrigins" | "cloudAuthOrigin"
  >,
) {
  return async function desktopAuthFetch(
    input: unknown,
  ): Promise<DesktopAuthFetchResponse> {
    const request = desktopAuthFetchRequestSchema.parse(input);
    const url = new URL(request.url);
    assertAllowedDesktopAuthUrl(url, environment.allowedCloudApiOrigins());

    const headers = createDesktopAuthHeaders(request.headers);
    const authOrigin = environment.cloudAuthOrigin(url);
    headers.set("Origin", authOrigin);
    headers.set("Referer", `${authOrigin}/`);

    const cookieHeader = await getDesktopAuthCookieHeader(url);
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    const fetchInit: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.body && request.method !== "GET" && request.method !== "HEAD") {
      fetchInit.body = decodeDesktopAuthFetchBody(request.body);
    }

    const response = await fetch(url, fetchInit);
    await persistDesktopAuthCookies(
      url,
      readSetCookieHeaders(response.headers),
    );

    return desktopAuthFetchResponseSchema.parse({
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()].filter(
        ([name]) => name.toLowerCase() !== "set-cookie",
      ),
      body: await response.text(),
    });
  };
}

function decodeDesktopAuthFetchBody(
  body: NonNullable<DesktopAuthFetchRequest["body"]>,
) {
  if (typeof body === "string") {
    return body;
  }

  return Buffer.from(body.data, "base64");
}

function assertAllowedDesktopAuthUrl(
  url: URL,
  allowedOrigins: ReadonlySet<string>,
) {
  if (!allowedOrigins.has(url.origin)) {
    throw new Error(
      `Blocked desktop API request to untrusted origin: ${url.origin}`,
    );
  }

  if (!url.pathname.startsWith("/api/")) {
    throw new Error(
      `Blocked desktop API request to unsupported path: ${url.pathname}`,
    );
  }
}

function createDesktopAuthHeaders(entries: Array<[string, string]>) {
  const headers = new Headers();
  const blockedHeaders = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
  ]);

  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    if (blockedHeaders.has(lowerName) || lowerName.startsWith("sec-ch-")) {
      continue;
    }

    headers.set(name, value);
  }

  return headers;
}

async function getDesktopAuthCookieHeader(url: URL) {
  const cookies = await electronSession.defaultSession.cookies.get({
    url: url.origin,
  });

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function persistDesktopAuthCookies(url: URL, setCookieHeaders: string[]) {
  await Promise.all(
    setCookieHeaders.map((header) => persistDesktopAuthCookie(url, header)),
  );
}

async function persistDesktopAuthCookie(url: URL, header: string) {
  const parsed = parseSetCookie(header);
  if (!parsed) return;

  if (parsed.deleteCookie) {
    await electronSession.defaultSession.cookies.remove(
      url.origin,
      parsed.name,
    );
    return;
  }

  await electronSession.defaultSession.cookies.set({
    url: url.origin,
    name: parsed.name,
    value: parsed.value,
    domain: parsed.domain,
    path: parsed.path,
    secure: parsed.secure,
    httpOnly: parsed.httpOnly,
    expirationDate: parsed.expirationDate,
    sameSite: parsed.sameSite,
  });
}
