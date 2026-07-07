// Tests for the dev-runner's pure logic + real port probing.
// Run: node scripts/dev-runner.test.mjs (same convention as the other
// scripts/*.test.mjs gates — plain asserts, exit non-zero on failure).
import assert from "node:assert/strict";
import net from "node:net";
import {
  BASE_PORTS,
  MAX_SLOTS,
  PortExhaustedError,
  SLOT_STRIDE,
  computeSlot,
  hashPath,
  isPortFree,
  portPlanForSlot,
  resolvePortPlan,
  synthesizeEnv,
} from "./dev-runner.mjs";

// --- slot determinism -------------------------------------------------------
assert.equal(
  computeSlot({ isWorktree: false, worktreePath: "/repo" }),
  0,
  "primary checkout must keep slot 0 (standard ports, tunnel workflow intact)",
);

const slotA = computeSlot({
  isWorktree: true,
  worktreePath: "/repo/.claude/worktrees/maker-a",
});
const slotB = computeSlot({
  isWorktree: true,
  worktreePath: "/repo/.claude/worktrees/maker-b",
});
assert.equal(
  slotA,
  computeSlot({
    isWorktree: true,
    worktreePath: "/repo/.claude/worktrees/maker-a",
  }),
  "a worktree keeps the same slot across runs",
);
assert.ok(slotA >= 1 && slotA < MAX_SLOTS, "worktree slots stay in range");
assert.notEqual(hashPath("a"), hashPath("b"), "hash discriminates paths");
assert.notEqual(slotA, slotB, "these two worktree paths get distinct slots");

// --- port plan + env synthesis ----------------------------------------------
const plan = portPlanForSlot(3);
assert.deepEqual(plan, {
  slot: 3,
  api: BASE_PORTS.api + 3 * SLOT_STRIDE,
  web: BASE_PORTS.web + 3 * SLOT_STRIDE,
  portal: BASE_PORTS.portal + 3 * SLOT_STRIDE,
});

const env = synthesizeEnv(plan);
assert.equal(env.PORT, String(plan.api));
assert.equal(env.API_URL, `http://localhost:${plan.api}`);
assert.equal(
  env.APP_URL,
  `http://localhost:${plan.web}`,
  "APP_URL must point at THIS worktree's web port (cookie/redirect synthesis)",
);
assert.equal(env.DEV_API_ORIGIN, `http://localhost:${plan.api}`);
assert.equal(env.PORTAL_APP_URL, `http://localhost:${plan.portal}`);

// --- all-or-nothing slot resolution ------------------------------------------
{
  // Slot 0's web port "busy" -> the whole trio moves to slot 1 together.
  const busy = new Set([portPlanForSlot(0).web]);
  const resolved = await resolvePortPlan(0, async (port) => !busy.has(port));
  assert.equal(resolved.slot, 1, "a partly-busy slot is skipped entirely");
}

{
  // Everything busy -> typed PortExhaustedError.
  await assert.rejects(
    resolvePortPlan(0, async () => false),
    (error) => error instanceof PortExhaustedError,
    "exhaustion must raise the typed error",
  );
}

// --- real port probing --------------------------------------------------------
{
  const blocker = net.createServer();
  await new Promise((resolve) =>
    blocker.listen({ port: 0, host: "127.0.0.1" }, resolve),
  );
  const busyPort = blocker.address().port;
  assert.equal(
    await isPortFree(busyPort),
    false,
    "a really-listening port probes busy",
  );
  await new Promise((resolve) => blocker.close(resolve));
  assert.equal(
    await isPortFree(busyPort),
    true,
    "the same port probes free after release",
  );
}

console.log("dev-runner tests passed");
