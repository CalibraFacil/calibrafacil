import { isValidCnpj } from "@calibra-facil/shared/cnpj";
import { describe, expect, it } from "vitest";

import { makeCnpj } from "./cnpj";

describe("makeCnpj", () => {
  it("produces a masked CNPJ with valid check digits", () => {
    const cnpj = makeCnpj("31406217");
    expect(cnpj).toMatch(/^\d{2}\.\d{3}\.\d{3}\/0001-\d{2}$/);
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it("supports other branches of the same company", () => {
    expect(makeCnpj("31406217", "0002")).not.toBe(makeCnpj("31406217"));
    expect(isValidCnpj(makeCnpj("31406217", "0002"))).toBe(true);
  });

  it("rejects malformed roots", () => {
    expect(() => makeCnpj("123")).toThrow();
    expect(() => makeCnpj("31406217", "1")).toThrow();
  });
});
