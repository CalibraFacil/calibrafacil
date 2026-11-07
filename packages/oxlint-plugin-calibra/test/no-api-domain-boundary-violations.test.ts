import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-api-domain-boundary-violations";
const USE = "export const y = x;\n";

describe("calibra/no-api-domain-boundary-violations (real oxlint)", () => {
  it("reports lib/ and middleware/ importing a domain, entry or not", async () => {
    await expectViolation(RULE, {
      "apps/api/src/lib/thing.ts": `import { x } from "../domains/jobs";\n${USE}`,
    });
    await expectViolation(RULE, {
      "apps/api/src/middleware/thing.ts": `import { x } from "../domains/jobs/commands/approve-job";\n${USE}`,
    });
  });

  it("reports a deep import into another domain", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/portal/routes/portal.ts": `import { x } from "../../jobs/commands/approve-job";\n${USE}`,
    });
    await expectViolation(RULE, {
      "apps/api/src/server/route-mounts.ts": `import { x } from "../domains/jobs/routes/jobs";\n${USE}`,
    });
    await expectViolation(RULE, {
      "apps/api/src/cron/dispatch.ts": `export { x } from "../domains/jobs/jobs";\n`,
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/portal/lazy.ts": `export const load = () => import("../jobs/jobs");\n`,
    });
  });

  it("allows another domain's public entry", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/portal/routes/portal.ts": `import { x } from "../../jobs";\n${USE}`,
      "apps/api/src/domains/portal/lib.ts": `import { x } from "../jobs/index";\n${USE}`,
      "apps/api/src/server/route-mounts.ts": `import { x } from "../domains/jobs";\n${USE}`,
      "apps/api/src/cron/dispatch.ts": `import { x } from "../domains/jobs";\n${USE}`,
    });
  });

  it("lets a domain import its own files and the platform freely", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/jobs/routes/jobs.ts": `import { x } from "../commands/approve-job";\nimport { y } from "../../../lib/org-db";\nimport { z } from "../../../middleware/permission";\nexport const w = [x, y, z];\n`,
    });
  });

  it("exempts specs and files outside apps/api/src", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/portal/routes/portal.spec.ts": `import { x } from "../../jobs/commands/approve-job";\n${USE}`,
      "apps/api/src/lib/__tests__/thing.ts": `import { x } from "../../domains/jobs/commands/approve-job";\n${USE}`,
      "apps/api/test/integration/job-commands.ts": `import { x } from "../../src/domains/jobs/commands/approve-job";\n${USE}`,
      "apps/other/src/lib/thing.ts": `import { x } from "../domains/jobs/commands/approve-job";\n${USE}`,
    });
  });
});
