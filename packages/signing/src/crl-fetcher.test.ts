import { createServer } from "node:http";
import {
  setOutboundTestOverrides,
  type ResolvedAddress,
} from "@calibra-facil/shared/safe-outbound-fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCrlFetcher } from "./crl-fetcher";

// The CRL address comes from the certificate of the document being verified,
// so it is untrusted input: a private or metadata host must never be called,
// while the conventional plain-http CRL distribution point of a public CA must
// keep working. The network is replaced by the outbound seam (the resolver and
// the transport), so nothing here touches a socket.

const PUBLIC_IP = "93.184.216.34";

type Call = { url: string; address: string };

function install(
  resolve: Record<string, string> | ((host: string) => ResolvedAddress[]),
  respond: (url: URL) => { status: number; body: Uint8Array<ArrayBuffer> },
) {
  const calls: Call[] = [];
  vi.unstubAllEnvs();
  setOutboundTestOverrides({
    resolver: async (hostname) => {
      if (typeof resolve === "function") return resolve(hostname);
      const address = resolve[hostname];
      if (!address) throw new Error("ENOTFOUND");
      return [{ address, family: address.includes(":") ? 6 : 4 }];
    },
    transport: async (request) => {
      calls.push({ url: request.url.href, address: request.address.address });
      const answer = respond(request.url);
      return {
        status: answer.status,
        statusText: "",
        headers: new Headers(),
        body: answer.body,
      };
    },
  });
  // Installed first, then production: the seam itself refuses production.
  vi.stubEnv("NODE_ENV", "production");
  return calls;
}

afterEach(() => {
  vi.unstubAllEnvs();
  setOutboundTestOverrides(null);
});

describe("createCrlFetcher", () => {
  it("fetches a public plain-http CRL distribution point (pinned to the resolved address)", async () => {
    const crl = new Uint8Array([1, 2, 3, 4]);
    const calls = install({ "crl.ca.example": PUBLIC_IP }, () => ({
      status: 200,
      body: crl,
    }));
    const bytes = await createCrlFetcher()("http://crl.ca.example/ac.crl");
    expect(bytes).toEqual(crl);
    expect(calls).toEqual([
      { url: "http://crl.ca.example/ac.crl", address: PUBLIC_IP },
    ]);
  });

  it.each([
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["loopback", "http://127.0.0.1:5432/"],
    ["a private network literal", "http://10.0.0.5/crl"],
    ["an IPv6 loopback", "http://[::1]/crl"],
  ])("returns null without calling %s", async (_name, url) => {
    const calls = install({}, () => ({ status: 200, body: new Uint8Array(4) }));
    expect(await createCrlFetcher()(url)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for a host name that resolves to a private address", async () => {
    const calls = install({ "crl.rebind.example": "172.18.0.3" }, () => ({
      status: 200,
      body: new Uint8Array(4),
    }));
    expect(
      await createCrlFetcher()("http://crl.rebind.example/x.crl"),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for a host name with a public and a private address", async () => {
    const calls = install(
      () => [
        { address: PUBLIC_IP, family: 4 },
        { address: "10.0.0.9", family: 4 },
      ],
      () => ({ status: 200, body: new Uint8Array(4) }),
    );
    expect(
      await createCrlFetcher()("http://crl.mixed.example/x.crl"),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for an empty or failed answer", async () => {
    install({ "crl.empty.example": PUBLIC_IP }, () => ({
      status: 200,
      body: new Uint8Array(0),
    }));
    expect(
      await createCrlFetcher()("http://crl.empty.example/a.crl"),
    ).toBeNull();

    install({ "crl.down.example": PUBLIC_IP }, () => ({
      status: 503,
      body: new Uint8Array(4),
    }));
    expect(
      await createCrlFetcher()("http://crl.down.example/a.crl"),
    ).toBeNull();
  });

  it("returns null for a body larger than the cap, and keeps a body within it (real socket)", async () => {
    const server = createServer((request, response) => {
      response.end(Buffer.alloc(request.url === "/big.crl" ? 4096 : 512, 7));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("no TCP port");
    }
    // The operator allow list is how the loopback test server is reachable.
    vi.stubEnv("OUTBOUND_ALLOW_PRIVATE_HOSTS", "127.0.0.1");
    try {
      const fetchCrl = createCrlFetcher({ maxBytes: 1024 });
      const base = `http://127.0.0.1:${address.port}`;
      expect(await fetchCrl(`${base}/big.crl`)).toBeNull();
      expect((await fetchCrl(`${base}/ok.crl`))?.byteLength).toBe(512);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
