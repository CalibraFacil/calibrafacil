#!/usr/bin/env node

import { spawn } from "node:child_process";

const forwardedArgs = process.argv.slice(2);

const args = [
  "turbo",
  "run",
  "dev",
  ...forwardedArgs,
  "--filter=!@calibra-facil/email",
  "--filter=!@calibra-facil/api",
  "--filter=!@calibra-facil/worker",
  "--filter=@calibra-facil/pdf-dev",
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
  console.error("dev failed to start:", error);
  process.exit(1);
});
