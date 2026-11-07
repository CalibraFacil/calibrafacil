import { describe, expect, it } from "vitest";

import { formatAddress, formatAddressLine } from "./address";

const FULL = {
  street: "Rua Um",
  number: "123",
  complement: "Sala 2",
  neighbourhood: "Centro",
  city: "Curitiba",
  state: "PR",
  cep: "80000-000",
};

describe("formatAddress", () => {
  it("groups street, complement, region and CEP on one line", () => {
    expect(formatAddress(FULL)).toBe(
      "Rua Um, 123 · Sala 2 · Centro - Curitiba - PR · 80000-000",
    );
  });

  it("drops blank and missing parts and trims the rest", () => {
    expect(
      formatAddress({
        street: " Rua Um ",
        number: "",
        city: "Curitiba",
        cep: null,
      }),
    ).toBe("Rua Um · Curitiba");
  });

  it("is empty when there is no address", () => {
    expect(formatAddress(null)).toBe("");
    expect(formatAddress(undefined)).toBe("");
    expect(formatAddress({})).toBe("");
  });
});

describe("formatAddressLine", () => {
  it("lists the parts in postal order, comma separated", () => {
    expect(formatAddressLine(FULL)).toBe(
      "Rua Um, 123, Sala 2, Centro, Curitiba, PR, 80000-000",
    );
    expect(
      formatAddressLine({
        street: "Rua Um",
        number: "123",
        city: "Curitiba",
        state: "PR",
      }),
    ).toBe("Rua Um, 123, Curitiba, PR");
    expect(formatAddressLine(null)).toBe("");
  });
});
