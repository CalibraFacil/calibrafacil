import { describe, expect, it } from "vitest";

import { foldText, slugify } from "./text";

describe("text", () => {
  it("folds accents and case", () => {
    expect(foldText("Balança ÁGUA")).toBe("balanca agua");
  });

  it("slugifies, caps and never ends on a hyphen", () => {
    expect(slugify("Açaí & Cia Ltda")).toBe("acai-cia-ltda");
    expect(slugify("Toledo do Brasil S/A")).toBe("toledo-do-brasil-s-a");
    expect(slugify("  Balança 01  ")).toBe("balanca-01");
    expect(slugify("a".repeat(50), 40)).toBe("a".repeat(40));
    expect(slugify("ab ".repeat(20), 5)).toBe("ab-ab");
    expect(slugify("!!!")).toBe("");
  });
});
