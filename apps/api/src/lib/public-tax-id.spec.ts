import { describe, expect, it } from "vitest";
import { publicTaxId, withPublicSigner } from "./public-tax-id";

describe("publicTaxId (roadmap 2 D3, LGPD)", () => {
  it("shows only the middle six digits of a CPF", () => {
    expect(publicTaxId("123.456.789-00")).toBe("***.456.789-**");
    expect(publicTaxId("12345678900")).toBe("***.456.789-**");
  });

  it("shows a CNPJ (a company, public in the register) as recorded", () => {
    expect(publicTaxId("12.345.678/0001-95")).toBe("12.345.678/0001-95");
  });

  it("hides anything else", () => {
    expect(publicTaxId("abc")).toBeNull();
    expect(publicTaxId(null)).toBeNull();
  });

  it("masks the signer of a verdict and leaves the rest alone", () => {
    expect(
      withPublicSigner({
        overall: "VALID",
        signer: { commonName: "Fulano", cpfCnpj: "123.456.789-00" },
      }),
    ).toEqual({
      overall: "VALID",
      signer: { commonName: "Fulano", cpfCnpj: "***.456.789-**" },
    });
    expect(withPublicSigner({ overall: "UNSIGNED", signer: null })).toEqual({
      overall: "UNSIGNED",
      signer: null,
    });
  });
});
