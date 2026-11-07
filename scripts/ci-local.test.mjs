// Tests for the CI step reader behind `pnpm ci:local`.
// Run: node scripts/ci-local.test.mjs (plain asserts, exit non-zero on failure).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localCommand, readJobRunSteps } from "./lib/ci-steps.mjs";

const sample = `name: CI
jobs:
  ci:
    name: Gates
    steps:
      - name: Checkout
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: One line
        run: bun run lint

      # a comment between steps
      - name: Block
        env:
          EVENT: \${{ github.event_name }}
        run: |
          filter=""
          if [ "$EVENT" = "pull_request" ]; then
            filter="--filter=x"
          fi
          bunx turbo test \${filter:+"$filter"}

  build:
    name: Build
    steps:
      - name: Not in the ci job
        run: pnpm build
`;

const steps = readJobRunSteps(sample, "ci");
assert.deepEqual(
  steps.map((step) => step.name),
  ["One line", "Block"],
  "steps that only use an action are the runner's setup; other jobs are not read",
);
assert.equal(steps[0].run, "bun run lint");
assert.match(
  steps[1].run,
  /^filter=""\nif \[ "\$EVENT" = "pull_request" \]; then/,
);
assert.match(steps[1].run, /bunx turbo test/);
assert.throws(() => readJobRunSteps(sample, "missing"), /No job "missing"/);

// Bun is how the workflow runs the repository's scripts; locally Node and pnpm do.
assert.equal(localCommand("bun run lint"), "pnpm run lint");
assert.equal(
  localCommand("bun scripts/check-blocked-deps.mjs"),
  "node scripts/check-blocked-deps.mjs",
);
assert.equal(localCommand("bunx turbo test"), "pnpm exec turbo test");
assert.equal(localCommand("pnpm test:role-split"), "pnpm test:role-split");

// The real workflow: every gate that broke main once because ci:local was a copy
// of it is a step ci:local now runs.
const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const real = readJobRunSteps(workflow, "ci").map((step) =>
  localCommand(step.run),
);
for (const gate of [
  "check-blocked-deps.mjs",
  "check-bun-pin.mjs",
  "check-app-boundaries.mjs",
  "pnpm install --frozen-lockfile",
  "pnpm run lint",
  "pnpm run knip",
  "pnpm run check:cycles",
  "pnpm run format:check",
  "pnpm run check-types",
  "pnpm test:role-split",
  "turbo test",
]) {
  assert.ok(
    real.some((command) => command.includes(gate)),
    `ci.yml's ci job runs ${gate}`,
  );
}
for (const command of real) {
  assert.doesNotMatch(command, /(^|\s)bunx?\s/, `${command} has no Bun left`);
}

console.log("ci-local tests passed");
