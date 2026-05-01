#!/usr/bin/env node

import { spawn } from "node:child_process";

const port = process.env.PDF_LOCAL_PORT || "3000";

const args = [
  "--filter",
  "@calibra-facil/api",
  "exec",
  "wrangler",
  "dev",
  "-c",
  "wrangler.jsonc",
  "-c",
  "../worker/wrangler.jsonc",
  "--persist-to",
  "../../.wrangler/state",
  "--port",
  port,
  "--local-protocol",
  "http",
  "--show-interactive-dev-session",
  "false",
];

const child = spawn("pnpm", args, {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("pdf local dev failed to start:", error);
  process.exit(1);
});
