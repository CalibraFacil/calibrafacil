import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./client-ip";

function context(headers: Record<string, string>, remoteAddress?: string) {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
    env: remoteAddress ? { REMOTE_ADDRESS: remoteAddress } : {},
  };
}

describe("clientIp (roadmap 2 D1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("without trusted proxies, ignores every forwarded header and answers the connection's peer", () => {
    expect(
      clientIp(
        context(
          {
            "x-forwarded-for": "198.51.100.1",
            "x-real-ip": "198.51.100.2",
            "cf-connecting-ip": "198.51.100.3",
          },
          "203.0.113.10",
        ),
      ),
    ).toBe("203.0.113.10");
  });

  it("behind one trusted proxy, believes only the entry that proxy appended (the rightmost)", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    // The client forged 198.51.100.1; Caddy appended the address it saw.
    expect(
      clientIp(
        context(
          { "x-forwarded-for": "198.51.100.1, 203.0.113.20" },
          "10.0.0.2",
        ),
      ),
    ).toBe("203.0.113.20");
  });

  it("behind two trusted proxies, takes the second entry from the right", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(
      clientIp(
        context(
          { "x-forwarded-for": "198.51.100.1, 203.0.113.30, 10.0.0.9" },
          "10.0.0.2",
        ),
      ),
    ).toBe("203.0.113.30");
  });

  it("falls back to the peer when the proxy wrote fewer entries than trusted", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(
      clientIp(context({ "x-forwarded-for": "203.0.113.40" }, "10.0.0.2")),
    ).toBe("10.0.0.2");
    expect(clientIp(context({}, "10.0.0.2"))).toBe("10.0.0.2");
  });

  it("answers null when neither a peer nor a trusted entry is known", () => {
    expect(clientIp(context({ "x-forwarded-for": "198.51.100.1" }))).toBe(null);
  });
});
