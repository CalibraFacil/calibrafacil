import { Container, getContainer } from "@cloudflare/containers";

/**
 * Gotenberg runs as a Cloudflare Container. The Worker below routes requests to
 * it and enforces a shared-secret gate, because Gotenberg has no authentication
 * of its own and must not be an open PDF-conversion relay on the public web.
 */
export class GotenbergContainer extends Container {
  // Gotenberg's HTTP API port.
  defaultPort = 3000;
  // Scale to zero after 10 minutes idle; next request cold-starts in a few s.
  sleepAfter = "10m";
}

interface Env {
  GOTENBERG_CONTAINER: DurableObjectNamespace<GotenbergContainer>;
  // Shared secret the caller must send as X-Gotenberg-Token. Set via:
  //   wrangler secret put GOTENBERG_TOKEN
  GOTENBERG_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const expected = env.GOTENBERG_TOKEN;
    if (!expected || request.headers.get("X-Gotenberg-Token") !== expected) {
      return new Response("Unauthorized\n", { status: 401 });
    }

    // One warm instance is plenty for low-volume conversion (LibreOffice is not
    // highly concurrent). For more parallelism use getRandom(binding, N).
    const container = getContainer(env.GOTENBERG_CONTAINER, "singleton");
    return container.fetch(request);
  },
};
