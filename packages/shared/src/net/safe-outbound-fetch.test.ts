import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOutboundPolicy } from "./outbound-policy";
import {
  OutboundRequestError,
  createOutboundFetch,
  safeOutboundFetch,
  type HostResolver,
  type PinnedRequest,
  type PinnedTransport,
  type RawOutboundResponse,
} from "./safe-outbound-fetch";

const PRODUCTION = buildOutboundPolicy({ allowInsecureHttp: false });
const DEVELOPMENT = buildOutboundPolicy({ allowInsecureHttp: true });

const PUBLIC_IP = "93.184.216.34";
const PUBLIC_IP_2 = "8.8.8.8";

function resolvingTo(...addresses: string[]): HostResolver {
  return async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
}

function answer(
  status: number,
  body = "",
  headers: Record<string, string> = {},
): RawOutboundResponse {
  return {
    status,
    statusText: "",
    headers: new Headers(headers),
    body: new TextEncoder().encode(body),
  };
}

function recordingTransport(
  respond: (request: PinnedRequest) => RawOutboundResponse,
) {
  const requests: PinnedRequest[] = [];
  const transport: PinnedTransport = async (request) => {
    requests.push(request);
    return respond(request);
  };
  return { transport, requests };
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server is not listening on a TCP port");
  }
  return address.port;
}

const failingResolver: HostResolver = async () => {
  throw new Error("ENOTFOUND");
};

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be refused");
}

function expectRefusal(error: unknown, code: string) {
  expect(error).toBeInstanceOf(OutboundRequestError);
  expect(error instanceof OutboundRequestError ? error.code : null).toBe(code);
}

describe("scheme", () => {
  it("refuses http in production and allows it in development", async () => {
    const { transport, requests } = recordingTransport(() => answer(200, "ok"));
    const refused = await rejection(
      safeOutboundFetch(
        "http://hooks.example.com/x",
        {},
        { policy: PRODUCTION, resolver: resolvingTo(PUBLIC_IP), transport },
      ),
    );
    expectRefusal(refused, "invalid_url");
    expect(requests).toHaveLength(0);

    const response = await safeOutboundFetch(
      "http://hooks.example.com/x",
      {},
      { policy: DEVELOPMENT, resolver: resolvingTo(PUBLIC_IP), transport },
    );
    expect(response.status).toBe(200);
  });

  it.each([
    "ftp://hooks.example.com/",
    "file:///etc/passwd",
    "https://user:secret@hooks.example.com/",
  ])("refuses %s", async (url) => {
    const { transport } = recordingTransport(() => answer(200));
    const error = await rejection(
      safeOutboundFetch(
        url,
        {},
        { policy: DEVELOPMENT, resolver: resolvingTo(PUBLIC_IP), transport },
      ),
    );
    expectRefusal(error, "invalid_url");
  });
});

describe("private destinations", () => {
  const PRIVATE_LITERALS = [
    "https://127.0.0.1/",
    "https://127.255.0.9/",
    "https://10.1.2.3/",
    "https://172.16.0.1/",
    "https://172.31.255.254/",
    "https://192.168.0.10/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://0.0.0.0/",
    "https://224.0.0.1/",
    "https://[::1]/",
    "https://[::]/",
    "https://[fc00::1]/",
    "https://[fd12:3456::1]/",
    "https://[fe80::1]/",
    "https://[ff02::1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://localhost/",
    "https://api.localhost/",
  ];

  it.each(PRIVATE_LITERALS)(
    "refuses the literal %s without a lookup",
    async (url) => {
      const resolver = vi.fn(resolvingTo(PUBLIC_IP));
      const { transport, requests } = recordingTransport(() => answer(200));
      const error = await rejection(
        safeOutboundFetch(url, {}, { policy: PRODUCTION, resolver, transport }),
      );
      expect(error).toBeInstanceOf(OutboundRequestError);
      expect(requests).toHaveLength(0);
    },
  );

  it.each([
    ["a host that resolves to loopback", ["127.0.0.1"]],
    ["a host that resolves to 10/8", ["10.0.0.7"]],
    ["a host that resolves to a docker bridge address", ["172.18.0.3"]],
    ["a host that resolves to the metadata address", ["169.254.169.254"]],
    ["a host that resolves to IPv6 loopback", ["::1"]],
    ["a host that resolves to a unique-local IPv6 address", ["fd00::5"]],
    [
      "a host that resolves to a mapped private address",
      ["::ffff:192.168.1.1"],
    ],
    ["a mix of public and private addresses", [PUBLIC_IP, "10.0.0.7"]],
    ["a mix with the private address first", ["10.0.0.7", PUBLIC_IP]],
    ["a public IPv4 and a loopback IPv6", [PUBLIC_IP, "::1"]],
  ])("refuses %s", async (_name, addresses) => {
    const { transport, requests } = recordingTransport(() => answer(200));
    const error = await rejection(
      safeOutboundFetch(
        "https://hooks.example.com/x",
        {},
        { policy: PRODUCTION, resolver: resolvingTo(...addresses), transport },
      ),
    );
    expectRefusal(error, "blocked_address");
    expect(requests).toHaveLength(0);
  });

  it("refuses a host that does not resolve", async () => {
    const resolver = failingResolver;
    const error = await rejection(
      safeOutboundFetch(
        "https://nowhere.example.com/",
        {},
        { policy: PRODUCTION, resolver },
      ),
    );
    expectRefusal(error, "dns_failed");
  });
});

describe("DNS pinning", () => {
  it("resolves once and connects to the validated address", async () => {
    const resolver = vi.fn(resolvingTo(PUBLIC_IP, PUBLIC_IP_2));
    const { transport, requests } = recordingTransport(() => answer(200, "ok"));
    await safeOutboundFetch(
      "https://hooks.example.com:8443/path?q=1",
      { method: "POST", body: '{"a":1}', headers: { "x-test": "1" } },
      { policy: PRODUCTION, resolver, transport },
    );
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith("hooks.example.com");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.address).toEqual({ address: PUBLIC_IP, family: 4 });
    expect(requests[0]?.url.host).toBe("hooks.example.com:8443");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers["x-test"]).toBe("1");
    expect(requests[0]?.headers["content-length"]).toBe("7");
    expect(new TextDecoder().decode(requests[0]?.body)).toBe('{"a":1}');
  });

  it("tries the next validated address when one cannot be reached", async () => {
    const attempted: string[] = [];
    const transport: PinnedTransport = async (request) => {
      attempted.push(request.address.address);
      if (request.address.address === PUBLIC_IP) {
        throw new OutboundRequestError("network", "ECONNREFUSED");
      }
      return answer(200, "ok");
    };
    const response = await safeOutboundFetch(
      "https://hooks.example.com/",
      {},
      {
        policy: PRODUCTION,
        resolver: resolvingTo(PUBLIC_IP, PUBLIC_IP_2),
        transport,
      },
    );
    expect(response.status).toBe(200);
    expect(attempted).toEqual([PUBLIC_IP, PUBLIC_IP_2]);
  });
});

describe("redirects", () => {
  it("returns the 3xx untouched by default and never follows it", async () => {
    const { transport, requests } = recordingTransport(() =>
      answer(302, "", { location: "http://10.0.0.5/admin" }),
    );
    const response = await safeOutboundFetch(
      "https://hooks.example.com/",
      {},
      { policy: PRODUCTION, resolver: resolvingTo(PUBLIC_IP), transport },
    );
    expect(response.status).toBe(302);
    expect(response.ok).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it("refuses a redirect to a private literal", async () => {
    const { transport, requests } = recordingTransport(() =>
      answer(302, "", { location: "http://10.0.0.5/admin" }),
    );
    const error = await rejection(
      safeOutboundFetch(
        "https://hooks.example.com/",
        {},
        {
          policy: DEVELOPMENT,
          maxRedirects: 3,
          resolver: resolvingTo(PUBLIC_IP),
          transport,
        },
      ),
    );
    expectRefusal(error, "blocked_address");
    expect(requests).toHaveLength(1);
  });

  it("refuses a redirect to a host that resolves privately", async () => {
    const resolver: HostResolver = async (hostname) =>
      hostname === "internal.example.com"
        ? [{ address: "10.0.0.9", family: 4 }]
        : [{ address: PUBLIC_IP, family: 4 }];
    const { transport, requests } = recordingTransport(() =>
      answer(301, "", { location: "https://internal.example.com/x" }),
    );
    const error = await rejection(
      safeOutboundFetch(
        "https://hooks.example.com/",
        {},
        { policy: PRODUCTION, maxRedirects: 3, resolver, transport },
      ),
    );
    expectRefusal(error, "blocked_address");
    expect(requests).toHaveLength(1);
  });

  it("refuses a redirect that downgrades to http in production", async () => {
    const { transport } = recordingTransport(() =>
      answer(302, "", { location: "http://hooks.example.com/plain" }),
    );
    const error = await rejection(
      safeOutboundFetch(
        "https://hooks.example.com/",
        {},
        {
          policy: PRODUCTION,
          maxRedirects: 3,
          resolver: resolvingTo(PUBLIC_IP),
          transport,
        },
      ),
    );
    expectRefusal(error, "invalid_url");
  });

  it("follows a bounded number of public redirects, dropping credentials across origins", async () => {
    const { transport, requests } = recordingTransport((request) =>
      request.url.hostname === "hooks.example.com"
        ? answer(307, "", { location: "https://other.example.org/landing" })
        : answer(200, "landed"),
    );
    const response = await safeOutboundFetch(
      "https://hooks.example.com/start",
      {
        method: "POST",
        body: "payload",
        headers: { authorization: "Bearer secret", "x-keep": "1" },
      },
      {
        policy: PRODUCTION,
        maxRedirects: 2,
        resolver: resolvingTo(PUBLIC_IP),
        transport,
      },
    );
    expect(await response.text()).toBe("landed");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.authorization).toBe("Bearer secret");
    expect(requests[1]?.headers.authorization).toBeUndefined();
    expect(requests[1]?.headers["x-keep"]).toBe("1");
    expect(requests[1]?.method).toBe("POST");
    expect(new TextDecoder().decode(requests[1]?.body)).toBe("payload");
  });

  it("turns a 303 into a GET without a body", async () => {
    const { transport, requests } = recordingTransport((request) =>
      request.url.pathname === "/start"
        ? answer(303, "", { location: "/done" })
        : answer(200, "ok"),
    );
    await safeOutboundFetch(
      "https://hooks.example.com/start",
      { method: "POST", body: "payload" },
      {
        policy: PRODUCTION,
        maxRedirects: 2,
        resolver: resolvingTo(PUBLIC_IP),
        transport,
      },
    );
    expect(requests[1]?.method).toBe("GET");
    expect(requests[1]?.body).toBeUndefined();
  });

  it("gives up on a redirect loop", async () => {
    const { transport, requests } = recordingTransport(() =>
      answer(302, "", { location: "https://hooks.example.com/again" }),
    );
    const error = await rejection(
      safeOutboundFetch(
        "https://hooks.example.com/",
        {},
        {
          policy: PRODUCTION,
          maxRedirects: 2,
          resolver: resolvingTo(PUBLIC_IP),
          transport,
        },
      ),
    );
    expectRefusal(error, "too_many_redirects");
    expect(requests).toHaveLength(3);
  });
});

describe("allowlist (OUTBOUND_ALLOW_PRIVATE_HOSTS)", () => {
  it("is off by default", async () => {
    const { transport } = recordingTransport(() => answer(200));
    expectRefusal(
      await rejection(
        safeOutboundFetch(
          "https://erp.lan/",
          {},
          {
            policy: PRODUCTION,
            resolver: resolvingTo("10.0.0.7"),
            transport,
          },
        ),
      ),
      "blocked_address",
    );
  });

  it.each([
    ["a host name", ["erp.lan"], "https://erp.lan/", "10.0.0.7"],
    ["a wildcard", ["*.corp.example"], "https://erp.corp.example/", "10.0.0.7"],
    ["a CIDR range", ["10.0.0.0/24"], "https://erp.lan/", "10.0.0.7"],
    ["an IP literal", ["10.0.0.7"], "https://10.0.0.7/", "10.0.0.7"],
    ["a range for a literal", ["10.0.0.0/24"], "https://10.0.0.9/", "10.0.0.9"],
    [
      "a range for a mapped answer",
      ["10.0.0.0/24"],
      "https://erp.lan/",
      "::ffff:10.0.0.7",
    ],
  ])("lets through %s", async (_name, entries, url, resolved) => {
    const policy = buildOutboundPolicy({ allowPrivateHosts: entries });
    const { transport, requests } = recordingTransport(() => answer(200, "ok"));
    const response = await safeOutboundFetch(
      url,
      {},
      { policy, resolver: resolvingTo(resolved), transport },
    );
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
  });

  it("does not let an allowed range cover other private hosts", async () => {
    const policy = buildOutboundPolicy({ allowPrivateHosts: ["10.0.0.0/24"] });
    const { transport } = recordingTransport(() => answer(200));
    for (const resolved of ["10.0.1.7", "192.168.0.1", "127.0.0.1"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- independent refusals, order is irrelevant.
      const error = await rejection(
        safeOutboundFetch(
          "https://erp.lan/",
          {},
          { policy, resolver: resolvingTo(resolved), transport },
        ),
      );
      expectRefusal(error, "blocked_address");
    }
  });

  it("does not let an allowed host name vouch for another", async () => {
    const policy = buildOutboundPolicy({ allowPrivateHosts: ["erp.lan"] });
    const { transport } = recordingTransport(() => answer(200));
    expectRefusal(
      await rejection(
        safeOutboundFetch(
          "https://other.lan/",
          {},
          { policy, resolver: resolvingTo("10.0.0.7"), transport },
        ),
      ),
      "blocked_address",
    );
  });

  it("ignores entries it cannot read and reports them", () => {
    const invalid: string[] = [];
    const policy = buildOutboundPolicy(
      { allowPrivateHosts: ["erp.lan", "10.0.0.0/99", "bad host!", "*."] },
      (entry) => invalid.push(entry),
    );
    expect(policy.allowedHosts).toEqual(["erp.lan"]);
    expect(policy.allowedRanges).toHaveLength(0);
    expect(invalid).toEqual(["10.0.0.0/99", "bad host!", "*."]);
  });
});

describe("over a real socket", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function listen(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ) {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = portOf(server);
    return { port, base: `http://127.0.0.1:${port}` };
  }

  const LOOPBACK_ALLOWED = buildOutboundPolicy({
    allowInsecureHttp: true,
    allowPrivateHosts: ["127.0.0.1"],
  });

  it("refuses to reach a loopback server unless the operator allowed it", async () => {
    const hit = vi.fn();
    const { base } = await listen((_request, response) => {
      hit();
      response.end("secret");
    });
    const refused = await rejection(
      safeOutboundFetch(base, {}, { policy: DEVELOPMENT }),
    );
    expectRefusal(refused, "blocked_address");
    expect(hit).not.toHaveBeenCalled();

    const allowed = await safeOutboundFetch(
      base,
      {},
      { policy: LOOPBACK_ALLOWED },
    );
    expect(await allowed.text()).toBe("secret");
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it("sends the request to the pinned IP with the original Host header", async () => {
    let seen: { host?: string; method?: string; url?: string; body: string } = {
      body: "",
    };
    const { port } = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        seen = {
          host: request.headers.host,
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString(),
        };
        response.writeHead(201, { "content-type": "application/json" });
        response.end('{"ok":true}');
      });
    });
    const policy = buildOutboundPolicy({
      allowInsecureHttp: true,
      allowPrivateHosts: ["erp.test"],
    });
    const response = await safeOutboundFetch(
      `http://erp.test:${port}/hook?x=1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"hello":"world"}',
      },
      { policy, resolver: resolvingTo("127.0.0.1") },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toEqual({
      host: `erp.test:${port}`,
      method: "POST",
      url: "/hook?x=1",
      body: '{"hello":"world"}',
    });
  });

  it("follows a redirect to a second server and refuses one to a private literal", async () => {
    const target = await listen((_request, response) => response.end("final"));
    const redirecting = await listen((request, response) => {
      response.writeHead(302, {
        location:
          request.url === "/private"
            ? "http://10.9.9.9/"
            : `${target.base}/landing`,
      });
      response.end();
    });
    const followed = await safeOutboundFetch(
      `${redirecting.base}/`,
      {},
      { policy: LOOPBACK_ALLOWED, maxRedirects: 2 },
    );
    expect(await followed.text()).toBe("final");

    const refused = await rejection(
      safeOutboundFetch(
        `${redirecting.base}/private`,
        {},
        { policy: LOOPBACK_ALLOWED, maxRedirects: 2 },
      ),
    );
    expectRefusal(refused, "blocked_address");
  });

  it("times out on a destination that never answers", async () => {
    const { base } = await listen(() => {
      // Accepts the request and says nothing.
    });
    const started = Date.now();
    const error = await rejection(
      safeOutboundFetch(base, {}, { policy: LOOPBACK_ALLOWED, timeoutMs: 250 }),
    );
    expectRefusal(error, "timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("times out on a destination that never finishes its body", async () => {
    const { base } = await listen((_request, response) => {
      response.writeHead(200);
      response.write("partial");
    });
    const error = await rejection(
      safeOutboundFetch(base, {}, { policy: LOOPBACK_ALLOWED, timeoutMs: 250 }),
    );
    expectRefusal(error, "timeout");
  });

  it("honours a caller's abort signal", async () => {
    const { base } = await listen(() => {});
    const controller = new AbortController();
    const pending = rejection(
      safeOutboundFetch(
        base,
        {},
        { policy: LOOPBACK_ALLOWED, signal: controller.signal },
      ),
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 50);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toBe("cancelled");
  });

  it("refuses a response larger than the cap by default", async () => {
    const { base } = await listen((_request, response) => {
      response.end("x".repeat(100_000));
    });
    const error = await rejection(
      safeOutboundFetch(
        base,
        {},
        { policy: LOOPBACK_ALLOWED, maxResponseBytes: 1024 },
      ),
    );
    expectRefusal(error, "response_too_large");
  });

  it("refuses an oversize response that does not announce its length", async () => {
    const { base } = await listen((_request, response) => {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.write("x".repeat(5000));
      response.end("y".repeat(5000));
    });
    const error = await rejection(
      safeOutboundFetch(
        base,
        {},
        { policy: LOOPBACK_ALLOWED, maxResponseBytes: 1024 },
      ),
    );
    expectRefusal(error, "response_too_large");
  });

  it("truncates to the cap and stops reading when asked to", async () => {
    let writes = 0;
    let closed = false;
    const { base } = await listen((_request, response) => {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.on("close", () => {
        closed = true;
      });
      const timer = setInterval(() => {
        writes += 1;
        response.write("z".repeat(4096));
      }, 5);
      response.on("close", () => clearInterval(timer));
    });
    const response = await safeOutboundFetch(
      base,
      {},
      {
        policy: LOOPBACK_ALLOWED,
        maxResponseBytes: 1000,
        onOversize: "truncate",
        timeoutMs: 5000,
      },
    );
    const text = await response.text();
    expect(text).toHaveLength(1000);
    expect(text).toBe("z".repeat(1000));
    await vi.waitFor(() => expect(closed).toBe(true));
    const seenAtClose = writes;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(writes).toBe(seenAtClose);
  });

  it("returns a small body whole, headers included", async () => {
    const { base } = await listen((_request, response) => {
      response.writeHead(202, { "x-trace": "abc" });
      response.end("accepted");
    });
    const response = await safeOutboundFetch(
      base,
      {},
      { policy: LOOPBACK_ALLOWED },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("x-trace")).toBe("abc");
    expect(await response.text()).toBe("accepted");
  });

  it("reports an unreachable port as a network failure", async () => {
    const { port } = await listen(() => {});
    const dead = createServer();
    await new Promise<void>((resolve) => {
      dead.listen(0, "127.0.0.1", resolve);
    });
    const deadPort = portOf(dead);
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    expect(port).not.toBe(deadPort);
    const error = await rejection(
      safeOutboundFetch(
        `http://127.0.0.1:${deadPort}/`,
        {},
        { policy: LOOPBACK_ALLOWED },
      ),
    );
    expectRefusal(error, "network");
  });

  it("works through the fetch-shaped adapter", async () => {
    const { base } = await listen((request, response) => {
      response.end(`${request.method} ${request.headers["x-id"]}`);
    });
    const outboundFetch = createOutboundFetch({ policy: LOOPBACK_ALLOWED });
    const response = await outboundFetch(`${base}/`, {
      method: "PUT",
      headers: { "x-id": "42" },
      body: "x",
    });
    expect(await response.text()).toBe("PUT 42");
  });
});
