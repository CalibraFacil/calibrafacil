import { describe, it, vi } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-app-ui-primitive-recreation";

// Each case spawns the real oxlint binary; under a parallel `turbo test` the
// default 5s is not enough.
vi.setConfig({ testTimeout: 30_000 });

describe("calibra/no-app-ui-primitive-recreation (real oxlint)", () => {
  it("REQ-UI-4: reports an app-local copy of a package component", async () => {
    await expectViolation(RULE, {
      "apps/web/src/components/ui/button.tsx": "export const Button = 1;\n",
    });
    await expectViolation(RULE, {
      "apps/portal/src/components/ui/card.tsx": "export const Card = 1;\n",
    });
  });

  it("REQ-UI-4: reports the old @/components/ui path of a package component", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/jobs/page.tsx":
        'import { Button } from "@/components/ui/button";\nexport const b = Button;\n',
    });
  });

  it("REQ-UI-4: allows components only one app renders", async () => {
    await expectClean(RULE, {
      "apps/web/src/components/ui/currency-input.tsx":
        "export const CurrencyInput = 1;\n",
      "apps/web/src/features/finance/page.tsx":
        'import { CurrencyInput } from "@/components/ui/currency-input";\nexport const c = CurrencyInput;\n',
    });
  });

  it("REQ-UI-4: allows importing from the package", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/jobs/page.tsx":
        'import { Button } from "@calibra-facil/ui/button";\nexport const b = Button;\n',
    });
  });

  it("REQ-UI-4: does not touch the package itself or other directories", async () => {
    await expectClean(RULE, {
      "packages/ui/src/components/button.tsx": "export const Button = 1;\n",
      "apps/web/src/components/button.tsx": "export const Button = 1;\n",
    });
  });

  it("REQ-UI-4: leaves apps outside web/portal (the marketing site) alone", async () => {
    await expectClean(RULE, {
      "apps/site/src/components/ui/button.tsx": "export const Button = 1;\n",
      "apps/site/src/components/hero.tsx":
        'import { Button } from "@/components/ui/button";\nexport const Hero = Button;\n',
    });
  });
});
