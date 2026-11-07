import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-features-import-from-low-layers";

describe("calibra/no-features-import-from-low-layers (real oxlint)", () => {
  it.each(["components", "lib", "utils", "hooks"])(
    "reports a features alias import from apps/web/src/%s",
    async (layer) => {
      await expectViolation(RULE, {
        [`apps/web/src/${layer}/thing.ts`]:
          'import { x } from "@/features/jobs/queries";\nexport const y = x;\n',
      });
    },
  );

  it("covers the portal app too", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/components/brand.tsx":
        'import { x } from "@/features/branding/branding-context";\nexport const y = x;\n',
    });
    await expectClean(RULE, {
      "apps/portal/src/features/shell/portal-header.tsx":
        'import { x } from "@/features/branding/branding-context";\nexport const y = x;\n',
    });
  });

  it("reports a relative import that resolves into features", async () => {
    await expectViolation(RULE, {
      "apps/web/src/components/nav/thing.tsx":
        'import { x } from "../../features/jobs/queries";\nexport const y = x;\n',
    });
  });

  it("reports a dynamic import and a re-export of a feature", async () => {
    await expectViolation(RULE, {
      "apps/web/src/lib/lazy.ts":
        'export const load = () => import("@/features/jobs/page");\n',
    });
    await expectViolation(RULE, {
      "apps/web/src/components/bell.tsx":
        'export { Bell } from "@/features/notifications/bell";\n',
    });
  });

  it("reports test files of a low layer too", async () => {
    await expectViolation(RULE, {
      "apps/web/src/lib/thing.test.ts":
        'import { x } from "@/features/jobs/queries";\nexport const y = x;\n',
    });
  });

  it("allows low layers to import each other, packages and app config", async () => {
    await expectClean(RULE, {
      "apps/web/src/components/thing.tsx":
        'import { a } from "@/lib/a";\nimport { b } from "../utils/b";\nimport { c } from "@calibra-facil/ui/button";\nimport { d } from "@/app/router/route-registry";\nexport const e = [a, b, c, d];\n',
    });
  });

  it("allows features to import features and low layers", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/jobs/page.tsx":
        'import { x } from "@/features/methods/queries";\nimport { y } from "@/lib/y";\nexport const z = [x, y];\n',
    });
  });

  it("does not match look-alike paths (a feature-named file, another app)", async () => {
    await expectClean(RULE, {
      "apps/web/src/lib/features-flag.ts":
        'import { x } from "./features-list";\nexport const y = x;\n',
      "apps/other/src/lib/thing.ts":
        'import { x } from "@/features/jobs/queries";\nexport const y = x;\n',
    });
  });
});
