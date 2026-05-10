import { Buffer } from "node:buffer";
import { parseLocalServerBootstrapConfig } from "./bootstrap";
import { createLocalServerFromConfig, createLocalServerFromEnv } from "./server";
import { serve } from "@hono/node-server";

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to start local server.",
  );
  process.exit(1);
});

async function main() {
  const { app, config, database } =
    process.env.CALIBRA_LOCAL_SERVER_BOOTSTRAP_STDIN === "1"
      ? createLocalServerFromConfig(
          parseLocalServerBootstrapConfig(await readStdin()),
        )
      : createLocalServerFromEnv(process.env);

  const server = serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
  });

  console.log(
    `CalibraFacil local server listening on http://${config.host}:${config.port} [desktop:${config.desktopRunId}] [local-server:${config.localServerRunId}]`,
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      database.close();
      server.close(() => process.exit(0));
    });
  }
}

async function readStdin() {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
