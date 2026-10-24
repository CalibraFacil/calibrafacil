import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// REQ-SPLIT-2: the sync router is split by route group, so its route table
// (method, path, middleware chain, in registration order) is pinned in a
// snapshot recorded BEFORE the split. A dropped, reordered or re-guarded route,
// or a changed handler body, turns this red.
//
// `withLabPermission(...)` builds closures, so it is mocked to return one
// function named after its permission argument; every other middleware keeps
// its real name. Handler bodies are fingerprinted on their compiled source with
// module-import indirection and whitespace normalised away, so moving a helper
// between files does not change the fingerprint but editing the handler does.
//
// One deliberate change to a handler body after the snapshot was recorded: the
// unpaginated (protocol 1/2) bootstrap queries of POST /bootstrap moved into
// modules/sync/legacy-bootstrap.ts so the route no longer queries the global
// db. Only that route's fingerprint changed; every other line is the pre-split
// recording. P2-18i changed four more handler bodies, deliberately: POST /push
// (the event's transaction handle `o` is handed to the apply), POST
// /conflicts/:id/resolve (its audit row is written in `orgDb(lab).transaction`)
// and the attachment complete-upload / download routes (an attachment id of
// another laboratory's partition is refused). No route, method, middleware or
// order changed.
const { named } = vi.hoisted(() => ({
  named: <T extends (...args: never[]) => unknown>(fn: T, name: string) =>
    Object.defineProperty(fn, "name", { value: name }),
}));

vi.mock("../middleware/permission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middleware/permission")>()),
  withLabPermission: (permissions: unknown) => [
    named(
      async () => undefined,
      `withLabPermission(${JSON.stringify(permissions)})`,
    ),
  ],
}));

function fingerprint(handler: (...args: never[]) => unknown) {
  const source = handler
    .toString()
    .replace(/\(0,\s*__(?:vi|vite_ssr)_import_\d+__\.(\w+)\)/g, "$1")
    .replace(/__(?:vi|vite_ssr)_import_\d+__\./g, "")
    .replace(/\s+/g, "");
  return createHash("sha256").update(source).digest("hex").slice(0, 10);
}

describe("sync router route table", () => {
  it(
    "REQ-SPLIT-2 keeps every route, middleware and handler in order",
    { timeout: 60_000 },
    async () => {
      const { syncRouter } = await import("./sync");

      const table = syncRouter.routes
        .map(({ method, path, handler }) => {
          const name = handler.name;
          const isMock = name.startsWith("withLabPermission");
          return `${method} ${path} ${name || "<anonymous>"}${isMock ? "" : ` #${fingerprint(handler)}`}`;
        })
        .join("\n");

      await expect(`${table}\n`).toMatchFileSnapshot(
        "./__snapshots__/sync.route-table.txt",
      );
    },
  );
});
