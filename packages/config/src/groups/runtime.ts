import { defineGroup, example, integer, text } from "../define";

export const nodeEnvVar = text({
  env: "NODE_ENV",
  description:
    "Execution mode. `production` makes the variables marked required in production mandatory.",
  default: "development",
  example: example.active("development"),
});

export const runtimeGroup = defineGroup({
  name: "runtime",
  title: "Core",
  intro: [
    "Execution mode and the address the API listens on. The public addresses",
    "(API_URL, APP_URL, ...) are under Addresses.",
  ],
  vars: {
    nodeEnv: nodeEnvVar,
    port: integer({
      env: "PORT",
      description:
        "HTTP port of the API (and of the document-worker drain server). Falls back to API_PORT, then 3000 (8080 for the worker).",
      min: 1,
      max: 65_535,
      example: example.commented("3000"),
    }),
    apiPort: integer({
      env: "API_PORT",
      description: "HTTP port of the API when PORT is not set.",
      min: 1,
      max: 65_535,
      hidden: true,
    }),
    shutdownGraceMs: integer({
      env: "SHUTDOWN_GRACE_MS",
      description:
        "On SIGTERM/SIGINT the API and the worker stop taking new work and wait this long for what is running (a certificate render, a request) before they give up and exit. Keep the container's stop_grace_period above it (default 25 seconds). An unusable value means the default.",
      min: 0,
      default: 25_000,
      tolerant: true,
      example: example.commented("25000"),
    }),
    host: text({
      env: "HOST",
      description: "Address the API binds to.",
      default: "0.0.0.0",
    }),
    trustedProxyHops: integer({
      env: "TRUSTED_PROXY_HOPS",
      description:
        "How many reverse proxies in front of the API are trusted to append the client's address to X-Forwarded-For (1 behind the Caddy of deploy/compose.yaml). 0 (the default) ignores the forwarded headers and uses the connection's own address: a header a client sent is never believed unless a trusted proxy wrote it. Used for the audit trail's IP, rate limits and throttles.",
      min: 0,
      max: 5,
      default: 0,
      tolerant: true,
      example: example.commented("1"),
    }),
    maxBodyBytes: integer({
      env: "API_MAX_BODY_BYTES",
      description:
        "Largest request body the API accepts, in bytes (413 above it). Uploads of attachments and certificates go to the object store directly; this bounds JSON and form bodies. Default 26214400 (25 MiB).",
      min: 1024,
      default: 26_214_400,
      tolerant: true,
      example: example.commented("26214400"),
    }),
    rateLimitPerMinute: integer({
      env: "API_RATE_LIMIT_PER_MINUTE",
      description:
        "Requests per minute one client may make to the API before it is answered 429 with Retry-After (per signed-in user, else per client address; per API key on the public API). 0 turns the limiter off. Default 600.",
      min: 0,
      default: 600,
      tolerant: true,
      example: example.commented("600"),
    }),
    publicRateLimitPerMinute: integer({
      env: "API_PUBLIC_RATE_LIMIT_PER_MINUTE",
      description:
        "Requests per minute one client address may make to the unauthenticated endpoints (certificate verification, public quotes, sign-up, approval codes). 0 turns it off. Default 60.",
      min: 0,
      default: 60,
      tolerant: true,
      example: example.commented("60"),
    }),
  },
  derive: (values) => {
    const nodeEnv = values.nodeEnv.toLowerCase();
    return {
      /** Production by NODE_ENV. */
      isProduction: nodeEnv === "production",
      /** The port to listen on: PORT, then API_PORT. */
      listenPort: values.port ?? values.apiPort,
    };
  },
});
