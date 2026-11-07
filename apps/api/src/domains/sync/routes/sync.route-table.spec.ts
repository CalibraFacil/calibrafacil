import { describe, expect, it, vi } from "vitest";

// The sync router's route table (method, path and the middleware chain, in
// registration order) is pinned: a dropped, reordered or re-guarded route turns
// this red. `withLabPermission(...)` builds closures, so it is mocked to return
// one function named after its permission argument; every other middleware keeps
// its real name. Handler bodies are not pinned: what a handler does is the
// integration specs' job.
const { named } = vi.hoisted(() => ({
  named: <T extends (...args: never[]) => unknown>(fn: T, name: string) =>
    Object.defineProperty(fn, "name", { value: name }),
}));

vi.mock("../../../middleware/permission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/permission")>()),
  withLabPermission: (permissions: unknown) => [
    named(
      async () => undefined,
      `withLabPermission(${JSON.stringify(permissions)})`,
    ),
  ],
}));

// A router mounted with its own error handler (`createRouter`) has each handler
// wrapped by Hono; the wrapper keeps the original under this key. Unwrap to the
// handler the module registered.
function registered(handler: (...args: never[]) => unknown) {
  let current = handler;
  for (;;) {
    const inner: unknown = Reflect.get(current, "__COMPOSED_HANDLER");
    if (typeof inner !== "function") return current;
    current = inner;
  }
}

describe("sync router route table", () => {
  it(
    "REQ-SPLIT-2 keeps every route and its middleware chain in order",
    { timeout: 60_000 },
    async () => {
      const { syncRouter } = await import("./");

      const table = syncRouter.routes
        .map(({ method, path, handler }) => {
          return `${method} ${path} ${registered(handler).name || "<anonymous>"}`;
        })
        .join("\n");

      await expect(`${table}\n`).toMatchFileSnapshot(
        "./__snapshots__/sync.route-table.txt",
      );
    },
  );
});
