// Typed dev-runner with per-worktree port offsets.
//
// Running `pnpm dev` in more than one checkout (agent worktrees under
// .claude/worktrees, parallel clones) collides on the fixed ports
// (api 3000 / web 5173 / portal 5174) and — worse — inherits the tunnel
// API_URL from apps/api/.env, which scopes session cookies to
// .calibrafacil.com and silently breaks auth on localhost (the documented
// magic-link "works but session never sticks" footgun).
//
// This runner gives every worktree its own deterministic port slot, probes
// that the whole trio is actually free (advancing slots atomically when not),
// SYNTHESIZES the matching localhost env (API_URL/APP_URL/PORTAL_APP_URL +
// vite ports/proxy origin — real env beats .env in apps/api/src/bun.ts), and
// then execs the normal turbo dev pipeline. The PRIMARY checkout keeps slot 0
// = the standard ports, so the cloudflared-tunnel workflow is untouched.
//
//   pnpm dev:isolated              # web + api + portal on this worktree's slot
//   pnpm dev:isolated --print-env  # just print the synthesized env (for agents)
//
// Failure is typed and loud: PortExhaustedError (exit 78) when no slot in the
// range has all three ports free.
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const BASE_PORTS = Object.freeze({
  api: 3000,
  web: 5173,
  portal: 5174,
});

export const SLOT_STRIDE = 10;
export const MAX_SLOTS = 40;

export class PortExhaustedError extends Error {
  constructor(attempts) {
    super(
      `no free port slot found after probing ${attempts} slots (stride ${SLOT_STRIDE} from api:${BASE_PORTS.api}/web:${BASE_PORTS.web}/portal:${BASE_PORTS.portal}) — stop stale dev servers or raise MAX_SLOTS`,
    );
    this.name = "PortExhaustedError";
  }
}

/** Stable 32-bit FNV-1a hash so a worktree keeps the same slot across runs. */
export function hashPath(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Slot 0 (the standard ports) belongs to the PRIMARY checkout; a linked git
 * worktree gets a deterministic slot in [1, MAX_SLOTS) from its path.
 */
export function computeSlot({ isWorktree, worktreePath }) {
  if (!isWorktree) return 0;
  return 1 + (hashPath(worktreePath) % (MAX_SLOTS - 1));
}

export function portPlanForSlot(slot) {
  return {
    slot,
    api: BASE_PORTS.api + slot * SLOT_STRIDE,
    web: BASE_PORTS.web + slot * SLOT_STRIDE,
    portal: BASE_PORTS.portal + slot * SLOT_STRIDE,
  };
}

/**
 * Env for the dev processes. Overrides the tunnel values a developer may have
 * in apps/api/.env: bun.ts spreads real env AFTER the .env file, so these win
 * — cookies scope to localhost and the vite same-origin /api proxy carries
 * them, instead of Set-Cookie for .calibrafacil.com being silently dropped.
 */
export function synthesizeEnv(plan) {
  const apiOrigin = `http://localhost:${plan.api}`;
  return {
    PORT: String(plan.api),
    API_PORT: String(plan.api),
    WEB_DEV_PORT: String(plan.web),
    PORTAL_DEV_PORT: String(plan.portal),
    DEV_API_ORIGIN: apiOrigin,
    API_URL: apiOrigin,
    APP_URL: `http://localhost:${plan.web}`,
    PORTAL_APP_URL: `http://localhost:${plan.portal}`,
  };
}

export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * First slot (starting at `preferredSlot`, wrapping) whose WHOLE trio is free.
 * All-or-nothing per slot so the three apps always land on matching offsets.
 */
export async function resolvePortPlan(preferredSlot, probe = isPortFree) {
  for (let attempt = 0; attempt < MAX_SLOTS; attempt += 1) {
    const slot = (preferredSlot + attempt) % MAX_SLOTS;
    const plan = portPlanForSlot(slot);
    const free = await Promise.all([
      probe(plan.api),
      probe(plan.web),
      probe(plan.portal),
    ]);
    if (free.every(Boolean)) return plan;
  }
  throw new PortExhaustedError(MAX_SLOTS);
}

export function detectWorktree(cwd = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const commonDir = execFileSync(
    "git",
    ["rev-parse", "--git-common-dir"],
    { cwd, encoding: "utf8" },
  ).trim();
  const worktreePath = execFileSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd, encoding: "utf8" },
  ).trim();
  // In the primary checkout --git-common-dir equals the git dir; in a linked
  // worktree it points back at the primary's .git.
  const isWorktree = gitDir !== commonDir && !gitDir.endsWith("/.git");
  return { isWorktree, worktreePath };
}

async function main() {
  const printOnly = process.argv.includes("--print-env");

  const identity = detectWorktree();
  const preferredSlot = computeSlot(identity);
  const plan = await resolvePortPlan(preferredSlot);
  const env = synthesizeEnv(plan);

  if (plan.slot !== preferredSlot) {
    console.warn(
      `[dev-runner] preferred slot ${preferredSlot} was busy — using slot ${plan.slot}`,
    );
  }

  console.log(
    `[dev-runner] ${identity.isWorktree ? "worktree" : "primary checkout"} → slot ${plan.slot}\n` +
      `  api    http://localhost:${plan.api}\n` +
      `  web    http://localhost:${plan.web}\n` +
      `  portal http://localhost:${plan.portal}`,
  );

  if (printOnly) {
    for (const [key, value] of Object.entries(env)) {
      console.log(`export ${key}=${value}`);
    }
    return;
  }

  const child = spawn(
    "pnpm",
    [
      "turbo",
      "dev",
      "--filter=@calibra-facil/web",
      "--filter=@calibra-facil/api",
      "--filter=@calibra-facil/portal",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ...env },
    },
  );

  const forward = (signal) => {
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((error) => {
    if (error instanceof PortExhaustedError) {
      console.error(`[dev-runner] ${error.message}`);
      process.exit(78); // EX_CONFIG — typed, scriptable failure
    }
    console.error("[dev-runner] failed", error);
    process.exit(1);
  });
}
