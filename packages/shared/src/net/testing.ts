import { setOutboundTestOverrides } from "./safe-outbound-fetch";

/**
 * For specs that already stub `globalThis.fetch` to play a remote system: sends
 * `safeOutboundFetch` through that stub (host names resolve to a public
 * address, nothing touches a network) and returns the function that undoes it.
 * The stub sees `fetch(url, { method, headers, body })` as before.
 */
export function routeOutboundThroughGlobalFetch(): () => void {
  setOutboundTestOverrides({
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (request) => {
      const response = await globalThis.fetch(request.url.href, {
        method: request.method,
        headers: request.headers,
        body:
          request.body === undefined
            ? undefined
            : new TextDecoder().decode(request.body),
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: new Uint8Array(await response.arrayBuffer()),
      };
    },
  });
  return () => setOutboundTestOverrides(null);
}
