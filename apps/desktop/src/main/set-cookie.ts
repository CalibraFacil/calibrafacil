export function readSetCookieHeaders(headers: Headers) {
  if ("getSetCookie" in headers && typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (Array.isArray(cookies)) {
      return cookies.filter((cookie) => typeof cookie === "string");
    }
  }

  return splitSetCookieHeader(headers.get("set-cookie"));
}

export function splitSetCookieHeader(header: string | null) {
  if (!header) return [];

  const cookies: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const rest = header.slice(index).toLowerCase();
    if (rest.startsWith("expires=")) {
      inExpires = true;
    }

    if (inExpires && header[index] === ";") {
      inExpires = false;
    }

    if (
      header[index] === "," &&
      !inExpires &&
      /\s*[^=;,]+=[^;,]+/.test(header.slice(index + 1))
    ) {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }

  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

export type ParsedSetCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
  deleteCookie?: boolean;
};

export function parseSetCookie(header: string): ParsedSetCookie | null {
  const [nameValue, ...attributes] = header
    .split(";")
    .map((part) => part.trim());
  if (!nameValue) return null;

  const separatorIndex = nameValue.indexOf("=");
  if (separatorIndex <= 0) return null;

  const parsed: ParsedSetCookie = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValueParts] = attribute.split("=");
    if (!rawName) continue;

    const attributeName = rawName.toLowerCase();
    const attributeValue = rawValueParts.join("=");

    if (attributeName === "domain" && attributeValue) {
      parsed.domain = attributeValue;
    } else if (attributeName === "path" && attributeValue) {
      parsed.path = attributeValue;
    } else if (attributeName === "secure") {
      parsed.secure = true;
    } else if (attributeName === "httponly") {
      parsed.httpOnly = true;
    } else if (attributeName === "max-age") {
      const maxAge = Number(attributeValue);
      if (Number.isFinite(maxAge)) {
        parsed.deleteCookie = maxAge <= 0;
        parsed.expirationDate = Math.floor(Date.now() / 1000 + maxAge);
      }
    } else if (attributeName === "expires" && attributeValue) {
      const expiresAt = Date.parse(attributeValue);
      if (Number.isFinite(expiresAt)) {
        parsed.deleteCookie = expiresAt <= Date.now();
        parsed.expirationDate = Math.floor(expiresAt / 1000);
      }
    } else if (attributeName === "samesite") {
      const sameSite = attributeValue.toLowerCase();
      if (sameSite === "none") {
        parsed.sameSite = "no_restriction";
      } else if (sameSite === "lax" || sameSite === "strict") {
        parsed.sameSite = sameSite;
      }
    }
  }

  return parsed;
}
