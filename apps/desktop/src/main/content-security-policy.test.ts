import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  rendererResponseHeaders,
} from "./content-security-policy";

function directives(policy: string) {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources] as const;
    }),
  );
}

describe("buildContentSecurityPolicy", () => {
  const policy = buildContentSecurityPolicy({
    localServerHost: "127.0.0.1",
    cloudApiUrls: ["https://api.lab.example/", "https://api.lab.example/api"],
  });
  const parsed = directives(policy);

  it("allows scripts only from the app itself", () => {
    expect(parsed.get("script-src")).toEqual(["'self'"]);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(parsed.get("default-src")).toEqual(["'self'"]);
  });

  it("closes plugins, base URIs, framing of the app and form targets", () => {
    expect(parsed.get("object-src")).toEqual(["'none'"]);
    expect(parsed.get("base-uri")).toEqual(["'self'"]);
    expect(parsed.get("frame-ancestors")).toEqual(["'none'"]);
    expect(parsed.get("form-action")).toEqual(["'self'"]);
  });

  it("limits connections to the app, the local server, the cloud API and ViaCEP", () => {
    expect(parsed.get("connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:*",
      "https://api.lab.example",
      "https://viacep.com.br",
    ]);
  });

  it("keeps the image sources the UI needs", () => {
    expect(parsed.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https:",
      "https://api.lab.example",
    ]);
    expect(parsed.get("font-src")).toEqual(["'self'", "data:"]);
  });

  it("follows CALIBRA_LOCAL_HOST and brackets an IPv6 literal", () => {
    const local = directives(
      buildContentSecurityPolicy({
        localServerHost: "localhost",
        cloudApiUrls: [],
      }),
    );
    expect(local.get("connect-src")).toContain("http://localhost:*");

    const v6 = directives(
      buildContentSecurityPolicy({ localServerHost: "::1", cloudApiUrls: [] }),
    );
    expect(v6.get("connect-src")).toContain("http://[::1]:*");
  });

  it("cannot be bent by a hostile host or URL", () => {
    const hostile = buildContentSecurityPolicy({
      localServerHost: "x; script-src *",
      cloudApiUrls: ["javascript:alert(1)", "not a url", undefined, "ftp://h/"],
    });

    expect(directives(hostile).get("script-src")).toEqual(["'self'"]);
    expect(directives(hostile).get("connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:*",
      "https://viacep.com.br",
    ]);
  });

  it("keeps a local http cloud origin for development builds", () => {
    const dev = directives(
      buildContentSecurityPolicy({
        localServerHost: "127.0.0.1",
        cloudApiUrls: ["http://localhost:3000"],
      }),
    );

    expect(dev.get("connect-src")).toContain("http://localhost:3000");
    expect(dev.get("img-src")).toContain("http://localhost:3000");
  });
});

describe("rendererResponseHeaders", () => {
  it("attaches the policy to HTML documents", () => {
    const headers = rendererResponseHeaders("text/html; charset=utf-8", "p");

    expect(headers).toMatchObject({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "p",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("leaves other assets with their type only", () => {
    const headers = rendererResponseHeaders(
      "text/javascript; charset=utf-8",
      "p",
    );

    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("text/javascript; charset=utf-8");
  });
});
