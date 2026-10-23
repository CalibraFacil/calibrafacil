// Tests for the app-boundary guard.
// Run: node scripts/check-app-boundaries.test.mjs (same convention as the other
// scripts/*.test.mjs gates — plain asserts, exit non-zero on failure).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAppToAppDependencies, readApps } from "./check-app-boundaries.mjs";

const app = (dir, name, extra = {}) => ({
  dir,
  manifest: { name, ...extra },
});

// A package dependency is fine; so is an app depending on nothing.
assert.deepEqual(
  findAppToAppDependencies([
    app("apps/api", "@calibra-facil/api", {
      dependencies: { "@calibra-facil/jobs-core": "workspace:^" },
    }),
    app("apps/worker", "@calibra-facil/worker"),
  ]),
  [],
);

// An app depending on another app is a violation, in every dependency field.
for (const field of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  const violations = findAppToAppDependencies([
    app("apps/api", "@calibra-facil/api", {
      [field]: { "@calibra-facil/worker": "workspace:^" },
    }),
    app("apps/worker", "@calibra-facil/worker"),
  ]);
  assert.equal(violations.length, 1, field);
  assert.match(violations[0], /apps\/api depends on @calibra-facil\/worker/);
  assert.match(violations[0], new RegExp(field));
}

// The real repository is clean.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.deepEqual(findAppToAppDependencies(readApps(root)), []);

console.log("check-app-boundaries tests passed.");
