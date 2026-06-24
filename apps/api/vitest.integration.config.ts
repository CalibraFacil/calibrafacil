import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Real-DB integration tier (Docker/testcontainers). Kept separate from the fast
// `vitest.config.ts` so the default `test:run` stays Docker-free.
//
// FIX A — truncateAll() now skips empty tables (see test/integration/db.ts):
//   Instead of TRUNCATEing all ~131 tables every beforeEach, we detect which
//   tables actually have rows (via EXISTS) in one round-trip and truncate only
//   those. Empty-table EXISTS is near-instant; in practice a test dirtying 4-8
//   tables drops beforeEach from ~5 s to ~50-200 ms.
//
// FIX B — per-worker database isolation enables file-level parallelism:
//   global-setup.ts pushes the schema once into a TEMPLATE database
//   (calibra_tmpl). Each worker (identified by VITEST_POOL_ID) creates its own
//   database (calibra_w<id>) via CREATE DATABASE … TEMPLATE calibra_tmpl, so
//   concurrent files never share or clobber data. The Postgres container is
//   started with max_locks_per_transaction=256 (up from default 64) so many
//   concurrent TRUNCATE … CASCADE calls don't exhaust the lock table.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.int.spec.ts"],
    globalSetup: ["./test/integration/global-setup.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // Parallel: each worker gets its own database (calibra_w<VITEST_POOL_ID>)
    // so concurrent files never share data. See global-setup.ts / setup.ts.
    //
    // We do NOT cap maxWorkers here: vitest's default (numCpus - 1) is fine.
    // The shared Postgres container runs with max_locks_per_transaction=256 so
    // that many concurrent TRUNCATE … CASCADE operations don't exhaust the lock
    // table (the default 64 caused "out of shared memory" at high parallelism).
    fileParallelism: true,
    pool: "forks",
    // Generous timeout: seed + real middleware + DB queries; slowest specs
    // (service-orders) can run 20-30 s; 60 s handles all current specs.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
