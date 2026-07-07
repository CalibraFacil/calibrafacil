import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-hono-client-outside-client-runtime";

describe("calibra/no-hono-client-outside-client-runtime (real oxlint)", () => {
  it("reports raw hono/client use in a frontend app", async () => {
    await expectViolation(RULE, {
      "apps/web/src/lib/raw-rpc.ts":
        'import { hc } from "hono/client";\nexport const client = hc;\n',
    });
  });

  it("reports raw hono/client use in a shared package outside the allowlist", async () => {
    await expectViolation(RULE, {
      "packages/shared/src/rpc.ts":
        'import { hc } from "hono/client";\nexport const client = hc;\n',
    });
  });

  it("allows hono/client inside packages/client-runtime", async () => {
    await expectClean(RULE, {
      "packages/client-runtime/src/transport/cloud.ts":
        'import { hc } from "hono/client";\nexport const client = hc;\n',
    });
  });

  it("allows type-level hono/client inside packages/contracts", async () => {
    await expectClean(RULE, {
      "packages/contracts/src/api-app.ts":
        'import type { ClientRequestOptions } from "hono/client";\nexport type O = ClientRequestOptions;\n',
    });
  });

  it("ignores unrelated hono imports (only the client entrypoint is restricted)", async () => {
    await expectClean(RULE, {
      "apps/api/src/app.ts":
        'import { Hono } from "hono";\nexport const app = new Hono();\n',
    });
  });
});
