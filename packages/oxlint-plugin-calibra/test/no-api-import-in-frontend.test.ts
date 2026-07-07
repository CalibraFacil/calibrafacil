import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-api-import-in-frontend";

describe("calibra/no-api-import-in-frontend (real oxlint)", () => {
  it("reports a frontend file importing @calibra-facil/api", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/jobs/queries.ts":
        'import { jobsRouter } from "@calibra-facil/api";\nexport const x = jobsRouter;\n',
    });
  });

  it("reports a portal file importing an @calibra-facil/api subpath", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/lib/api.ts":
        'import type { Env } from "@calibra-facil/api/server/env";\nexport type E = Env;\n',
    });
  });

  it("reports a relative escape into apps/api", async () => {
    await expectViolation(RULE, {
      "apps/web/src/lib/sneaky.ts":
        'import { db } from "../../../api/src/lib/db";\nexport const d = db;\n',
    });
  });

  it("reports a dynamic import of the api package", async () => {
    await expectViolation(RULE, {
      "apps/web/src/lib/lazy.ts":
        'export const load = () => import("@calibra-facil/api");\n',
    });
  });

  it("reports a re-export from the api package", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/lib/reexport.ts":
        'export { something } from "@calibra-facil/api/routes/jobs";\n',
    });
  });

  it("allows the sanctioned client packages in frontend code", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/jobs/queries.ts": [
        'import { calibraApi } from "@calibra-facil/client-runtime";',
        'import type { JobDto } from "@calibra-facil/contracts";',
        "export const q = { calibraApi };",
        "export type J = JobDto;",
        "",
      ].join("\n"),
    });
  });

  it("does not apply outside the frontend apps (the api may import itself)", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/jobs.ts":
        'import { app } from "@calibra-facil/api";\nexport const a = app;\n',
      "packages/client-runtime/src/transport/cloud.ts":
        'import type { AppType } from "@calibra-facil/contracts";\nexport type T = AppType;\n',
    });
  });
});
