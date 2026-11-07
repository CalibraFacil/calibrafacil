// Helpers the desktop build and smoke scripts share. Each of them used to carry
// its own copy of these.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";

/** The repository root. */
const repoRoot = path.resolve(import.meta.dirname, "../..");

/** Fail with `message` unless `condition` holds. */
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

/** The `Authorization` header the local server expects from the desktop host. */
export function authHeaders(localApiToken) {
  return { Authorization: `Bearer ${localApiToken}` };
}

/** A TCP port nothing listens on right now, for a loopback test server. */
export function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate local port"));
        }
      });
    });
  });
}

/**
 * Run a command with its output going to this terminal; throws when it fails.
 * `shell` on Windows so `pnpm.cmd` and friends resolve.
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status ?? result.signal ?? "?"})`,
    );
  }
}
