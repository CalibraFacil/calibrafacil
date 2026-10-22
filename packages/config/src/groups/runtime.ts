import { defineGroup, example, integer, text } from "../define";

/** Set to `1` by Vercel on every deployment (preview and production). */
export const vercelVar = text({
  env: "VERCEL",
  description: "Set to 1 by Vercel on every deployment.",
  hidden: true,
});

export const vercelEnvVar = text({
  env: "VERCEL_ENV",
  description: "Vercel environment: production, preview or development.",
  hidden: true,
});

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
    vercel: vercelVar,
    vercelEnv: vercelEnvVar,
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
    host: text({
      env: "HOST",
      description: "Address the API binds to.",
      default: "0.0.0.0",
    }),
  },
  derive: (values) => {
    const nodeEnv = values.nodeEnv.toLowerCase();
    return {
      /** Production by NODE_ENV, or any Vercel deployment. */
      isProduction:
        nodeEnv === "production" ||
        values.vercel === "1" ||
        values.vercelEnv?.toLowerCase() === "production",
      /** Running on Vercel (any non-empty VERCEL). */
      isVercel: values.vercel !== undefined,
      /** The port to listen on: PORT, then API_PORT. */
      listenPort: values.port ?? values.apiPort,
    };
  },
});
