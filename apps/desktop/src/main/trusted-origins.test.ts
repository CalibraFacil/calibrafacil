import { describe, expect, it } from "vitest";
import { isTrustedUrl, resolveTrustedOrigins } from "./trusted-origins";

const base = { appScheme: "app", appHost: "calibra-facil" };
const packaged = resolveTrustedOrigins({ ...base, isPackaged: true });
const unpackaged = resolveTrustedOrigins({ ...base, isPackaged: false });

describe("isTrustedUrl", () => {
  it("accepts the packaged renderer", () => {
    for (const url of [
      "app://calibra-facil/",
      "app://calibra-facil",
      "app://calibra-facil/dashboard/jobs?x=1#top",
    ]) {
      expect(isTrustedUrl(url, packaged), url).toBe(true);
    }
  });

  it.each([
    // Real host is evil.example; the trusted origin is only userinfo.
    "app://calibra-facil@evil.example/",
    "app://calibra-facil:pw@evil.example/",
    // A hostname that merely starts with the trusted one.
    "app://calibra-facil.evil/",
    "app://calibra-facil.evil.example/",
    "app://evil.calibra-facil/",
    "app://calibra-facil:8080/",
    "app://Calibra-Facil/",
    "app://calibra%2Dfacil/",
    "app://calibra-facil%2eevil/",
    "app:calibra-facil",
    "app:///calibra-facil/",
    "app//calibra-facil/",
    // Wrong scheme with the right host.
    "http://calibra-facil/",
    "https://calibra-facil/",
  ])("rejects the packaged-origin bypass %s", (url) => {
    expect(isTrustedUrl(url, packaged)).toBe(false);
    expect(isTrustedUrl(url, unpackaged)).toBe(false);
  });

  it("keeps the dev origins out of a packaged build", () => {
    expect(isTrustedUrl("http://localhost:5173/", packaged)).toBe(false);
    expect(isTrustedUrl("http://127.0.0.1:5173/dashboard", packaged)).toBe(
      false,
    );
  });

  it("accepts the dev origins when unpackaged", () => {
    expect(isTrustedUrl("http://localhost:5173/", unpackaged)).toBe(true);
    expect(isTrustedUrl("http://127.0.0.1:5173/a?b#c", unpackaged)).toBe(true);
    expect(isTrustedUrl("http://LOCALHOST:5173/", unpackaged)).toBe(true);
    expect(isTrustedUrl("app://calibra-facil/", unpackaged)).toBe(true);
  });

  it("agrees with the browser that a backslash ends the authority", () => {
    // WHATWG parsing makes this origin http://localhost:5173 with the path
    // `/@evil.example/`, which is what Chromium would load too.
    expect(
      isTrustedUrl("http://localhost:5173\\@evil.example/", unpackaged),
    ).toBe(true);
    expect(
      isTrustedUrl("http://evil.example\\@localhost:5173/", unpackaged),
    ).toBe(false);
  });

  it.each([
    // The review's example: the host is evil.example.
    "http://localhost:5173@evil.example/",
    "http://localhost:5173:pw@evil.example/",
    "http://127.0.0.1:5173@evil.example/",
    "http://evil.example/@localhost:5173/",
    // Prefix-sharing hosts and ports.
    "http://localhost:51730/",
    "http://localhost:517/",
    "http://localhost:5173.evil.example/",
    "http://localhost.evil.example:5173/",
    "http://localhost.:5173/",
    "http://127.0.0.1:51730/",
    "http://127.0.0.1.evil.example:5173/",
    // Same host, different port or scheme.
    "http://localhost/",
    "http://localhost:80/",
    "https://localhost:5173/",
    // Encoded variants.
    "http://localhost%3A5173@evil.example/",
    "http://localhost%3a5173/",
    "http://localhost:5173%2F@evil.example/",
    "http://localhost:5173%40evil.example/",
    "http://%6Cocalhost:5173.evil.example/",
    // Not a web URL at all.
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "blob:http://localhost:5173/abc",
    "about:blank",
    "",
    "localhost:5173",
    "//localhost:5173/",
    "not a url",
  ])("rejects the unpackaged-origin bypass %s", (url) => {
    expect(isTrustedUrl(url, unpackaged), url).toBe(false);
    expect(isTrustedUrl(url, packaged), url).toBe(false);
  });

  it("rejects values that are not strings", () => {
    expect(isTrustedUrl(undefined, unpackaged)).toBe(false);
    expect(isTrustedUrl(null, unpackaged)).toBe(false);
    expect(isTrustedUrl(42, unpackaged)).toBe(false);
  });
});

describe("resolveTrustedOrigins", () => {
  it("adds the configured renderer URL only when unpackaged", () => {
    const configuredRendererUrl = "http://localhost:4173/some/path";

    const dev = resolveTrustedOrigins({
      ...base,
      isPackaged: false,
      configuredRendererUrl,
    });
    const prod = resolveTrustedOrigins({
      ...base,
      isPackaged: true,
      configuredRendererUrl,
    });

    expect(isTrustedUrl("http://localhost:4173/dashboard", dev)).toBe(true);
    expect(isTrustedUrl("http://localhost:4173/dashboard", prod)).toBe(false);
    expect(isTrustedUrl("http://localhost:41730/", dev)).toBe(false);
  });

  it("ignores a configured URL that is not http(s) or does not parse", () => {
    for (const configuredRendererUrl of [
      "file:///tmp/x",
      "nope",
      "",
      "app://x",
    ]) {
      const trusted = resolveTrustedOrigins({
        ...base,
        isPackaged: false,
        configuredRendererUrl,
      });
      expect([...trusted.web].sort()).toEqual([
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ]);
    }
  });
});
