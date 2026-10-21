import { describe, expect, it, vi } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-raw-locale-formatting";

// Each case spawns the real oxlint binary (several in the multi-file ones);
// under a parallel `turbo test` the default 5s is not enough.
vi.setConfig({ testTimeout: 30_000 });

describe("calibra/no-raw-locale-formatting (real oxlint)", () => {
  it("REQ-FMT-3: reports toLocaleDateString in a frontend feature", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/jobs/detail-model.ts":
        'export const f = (d: string) => new Date(d).toLocaleDateString("pt-BR");\n',
    });
  });

  it("REQ-FMT-3: reports toLocaleTimeString", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/lib/clock.ts":
        "export const f = (d: Date) => d.toLocaleTimeString();\n",
    });
  });

  it("REQ-FMT-3: reports toLocaleString (dates and numbers alike)", async () => {
    await expectViolation(RULE, {
      "packages/notifications/src/format.ts":
        'export const f = (n: number) => n.toLocaleString("pt-BR");\n',
    });
  });

  it("REQ-FMT-3: reports the bracket form and optional chaining", async () => {
    await expectViolation(RULE, {
      "apps/web/src/a.ts":
        'export const f = (d: Date) => d["toLocaleDateString"]("pt-BR");\n',
    });
    await expectViolation(RULE, {
      "apps/web/src/b.ts":
        "export const f = (d: Date | null) => d?.toLocaleString();\n",
    });
  });

  it("REQ-FMT-3: reports new Intl.DateTimeFormat", async () => {
    await expectViolation(RULE, {
      "packages/documents/src/dates.ts":
        'export const F = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });\n',
    });
  });

  it("REQ-FMT-3: reports new Intl.NumberFormat, called or constructed", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/finance/money.ts":
        'export const F = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });\n',
    });
    await expectViolation(RULE, {
      "apps/web/src/features/finance/money2.ts":
        'export const F = Intl.NumberFormat("pt-BR");\n',
    });
    await expectViolation(RULE, {
      "apps/web/src/features/finance/money3.ts":
        'export const F = new globalThis.Intl.NumberFormat("pt-BR");\n',
    });
  });

  it("REQ-FMT-3: allows the shared format module and the calendar-date module", async () => {
    await expectClean(RULE, {
      "packages/shared/src/format.ts":
        'export const F = new Intl.DateTimeFormat("pt-BR");\nexport const N = new Intl.NumberFormat("pt-BR");\n',
      "packages/shared/src/calendar-date.ts":
        'export const F = new Intl.DateTimeFormat("en-CA");\n',
    });
  });

  it("REQ-FMT-3: allows tests", async () => {
    await expectClean(RULE, {
      "apps/web/src/lib/date-only.test.ts":
        'export const x = new Date().toLocaleDateString("pt-BR");\n',
      "packages/notifications/src/calendar-date-format.spec.ts":
        'export const y = new Intl.NumberFormat("pt-BR");\n',
    });
  });

  it("REQ-FMT-3: does not flag the other format helpers or unrelated Intl use", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/ok.ts": [
        'import { formatInstant } from "@calibra-facil/shared/format";',
        'export const a = (d: Date) => formatInstant(d, "date");',
        'export const b = new Intl.PluralRules("pt-BR");',
        'export const c = (s: string) => s.toLocaleLowerCase("pt-BR");',
        "export const d = (value: { toLocaleDateString: string }) => value.toLocaleDateString;",
        "",
      ].join("\n"),
    });
  });

  it("REQ-FMT-3: the message points at the shared layer", async () => {
    const output = await expectViolation(RULE, {
      "apps/web/src/features/x.ts":
        "export const f = (d: Date) => d.toLocaleDateString();\n",
    });
    expect(output).toContain("@calibra-facil/shared/format");
  });

  it("REQ-FMT-3: grandfathers only the counted legacy occurrence (net-new fails)", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/signing.ts":
        'export const f = (d: Date) => d.toLocaleDateString("pt-BR");\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/signing.ts": [
        'export const f = (d: Date) => d.toLocaleDateString("pt-BR");',
        'export const g = (d: Date) => d.toLocaleDateString("pt-BR");',
        "",
      ].join("\n"),
    });
  });
});
