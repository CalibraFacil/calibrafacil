import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopCloudAuthProxy } from "./cloud-auth-proxy";

const proxies: DesktopCloudAuthProxy[] = [];

afterEach(() => {
  for (const proxy of proxies.splice(0)) {
    proxy.stop();
  }
});

describe("DesktopCloudAuthProxy", () => {
  it("forwards sync requests through the authenticated desktop fetcher", async () => {
    const responseHeaders: Array<[string, string]> = [
      ["content-type", "application/json"],
    ];
    const authFetch = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: responseHeaders,
      body: JSON.stringify({ ok: true }),
    }));
    const proxy = new DesktopCloudAuthProxy({
      targetBaseUrl: "https://api.example.test",
      authFetch,
      token: "proxy-token",
    });
    proxies.push(proxy);

    await proxy.start();
    const response = await fetch(`${proxy.baseUrl}/api/sync/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-calibra-desktop-cloud-proxy-token": "proxy-token",
      },
      body: JSON.stringify({ bootstrap: true }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(authFetch).toHaveBeenCalledWith({
      url: "https://api.example.test/api/sync/bootstrap",
      method: "POST",
      headers: expect.arrayContaining([["content-type", "application/json"]]),
      body: {
        encoding: "base64",
        data: Buffer.from(JSON.stringify({ bootstrap: true })).toString(
          "base64",
        ),
      },
    });
  });

  it("rejects requests without the per-session proxy token", async () => {
    const authFetch = vi.fn();
    const proxy = new DesktopCloudAuthProxy({
      targetBaseUrl: "https://api.example.test",
      authFetch,
      token: "proxy-token",
    });
    proxies.push(proxy);

    await proxy.start();
    const response = await fetch(`${proxy.baseUrl}/api/sync/bootstrap`);

    expect(response.status).toBe(401);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("only exposes cloud sync routes", async () => {
    const authFetch = vi.fn();
    const proxy = new DesktopCloudAuthProxy({
      targetBaseUrl: "https://api.example.test",
      authFetch,
      token: "proxy-token",
    });
    proxies.push(proxy);

    await proxy.start();
    const response = await fetch(`${proxy.baseUrl}/api/customers`, {
      headers: {
        "x-calibra-desktop-cloud-proxy-token": "proxy-token",
      },
    });

    expect(response.status).toBe(404);
    expect(authFetch).not.toHaveBeenCalled();
  });
});
