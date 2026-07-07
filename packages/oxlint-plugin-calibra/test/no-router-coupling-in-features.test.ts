import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-router-coupling-in-features";

describe("calibra/no-router-coupling-in-features (real oxlint)", () => {
  it("reports useSearch imported by a feature module", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/jobs/list-page.tsx":
        'import { useSearch } from "@tanstack/react-router";\nexport const s = useSearch;\n',
    });
  });

  it("reports createFileRoute imported by a feature module (even aliased)", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/jobs/route.ts":
        'import { createFileRoute as cfr } from "@tanstack/react-router";\nexport const r = cfr;\n',
    });
  });

  it("allows Link/useNavigate in features (only route-coupling APIs are banned)", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/jobs/list-page.tsx":
        'import { Link, useNavigate } from "@tanstack/react-router";\nexport const l = { Link, useNavigate };\n',
    });
  });

  it("allows route adapters to use createFileRoute (rule scopes to features/)", async () => {
    await expectClean(RULE, {
      "apps/web/src/routes/dashboard/jobs/index.tsx":
        'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/dashboard/jobs/")({});\n',
    });
  });

  it("exempts feature test files (route tests legitimately build a real router)", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/methods/from-template-page.test.tsx":
        'import { useSearch } from "@tanstack/react-router";\nexport const s = useSearch;\n',
    });
  });
});
