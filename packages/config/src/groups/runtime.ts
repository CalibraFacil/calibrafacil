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
