import { describe, expect, it } from "vitest";

import { UpdateOrganizationProfileSchema } from "./organization-profile";

describe("UpdateOrganizationProfileSchema", () => {
  it("trims text, keeps absent fields absent and clears on null or empty", () => {
    const parsed = UpdateOrganizationProfileSchema.parse({
      cnpj: "  12.345.678/0001-95 ",
      accreditationBody: "",
      website: null,
      accreditationActive: true,
    });

    expect(parsed.cnpj).toBe("12.345.678/0001-95");
    expect(parsed.accreditationBody).toBeNull();
    expect(parsed.website).toBeNull();
    expect(parsed.accreditationActive).toBe(true);
    // Absent: the route leaves the stored value as it is.
    expect(parsed.accreditationNumber).toBeUndefined();
    expect(parsed.street).toBeUndefined();
  });

  it("accepts ISO vigência bounds, clears an empty one and refuses a non-date", () => {
    const parsed = UpdateOrganizationProfileSchema.parse({
      accreditationValidFrom: "2026-01-01T03:00:00.000Z",
      accreditationValidUntil: "",
    });
    expect(parsed.accreditationValidFrom).toBe("2026-01-01T03:00:00.000Z");
    expect(parsed.accreditationValidUntil).toBeNull();

    expect(
      UpdateOrganizationProfileSchema.safeParse({
        accreditationValidFrom: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("does not carry fields it does not own (type, id, slug are not profile fields)", () => {
    const parsed = UpdateOrganizationProfileSchema.parse({
      type: "CLIENT",
      id: "other-org",
      slug: "x",
      cnpj: "11222333000181",
    });
    expect(Object.keys(parsed)).not.toContain("type");
    expect(Object.keys(parsed)).not.toContain("id");
    expect(Object.keys(parsed)).not.toContain("slug");
  });

  it("refuses text beyond its bound and a boolean that is not one", () => {
    expect(
      UpdateOrganizationProfileSchema.safeParse({
        permissionariaAuthorizationState: "SPX",
      }).success,
    ).toBe(false);
    expect(
      UpdateOrganizationProfileSchema.safeParse({
        accreditationActive: "yes",
      }).success,
    ).toBe(false);
  });

  it("validates the CNPJ with the shared validator (masked or bare), email and website", () => {
    for (const cnpj of ["11.222.333/0001-81", "11222333000181", "", null]) {
      expect(
        UpdateOrganizationProfileSchema.safeParse({ cnpj }).success,
        String(cnpj),
      ).toBe(true);
    }
    for (const cnpj of ["11.222.333/0001-82", "123", "abc"]) {
      expect(
        UpdateOrganizationProfileSchema.safeParse({ cnpj }).success,
        cnpj,
      ).toBe(false);
    }
    for (const email of ["contato@lab.com.br", "", null]) {
      expect(
        UpdateOrganizationProfileSchema.safeParse({ email }).success,
        String(email),
      ).toBe(true);
    }
    for (const email of ["contato", "a@b", "@lab.com"]) {
      expect(
        UpdateOrganizationProfileSchema.safeParse({ email }).success,
        email,
      ).toBe(false);
    }
    for (const website of [
      "https://lab.com.br",
      "http://lab.com.br/x",
      "www.lab.com.br",
      "",
    ]) {
      expect(
        UpdateOrganizationProfileSchema.safeParse({ website }).success,
        website,
      ).toBe(true);
    }
    for (const website of [
      "javascript:alert(1)",
      "ftp://lab.com.br",
      "lab",
      "not a site",
    ]) {
      expect(
        UpdateOrganizationProfileSchema.safeParse({ website }).success,
        website,
      ).toBe(false);
    }
  });

  it("refuses a vigência that starts after it ends, and accepts equal or one-sided bounds", () => {
    expect(
      UpdateOrganizationProfileSchema.safeParse({
        accreditationValidFrom: "2027-01-01T00:00:00.000Z",
        accreditationValidUntil: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    for (const window of [
      {
        accreditationValidFrom: "2026-01-01T00:00:00.000Z",
        accreditationValidUntil: "2026-01-01T00:00:00.000Z",
      },
      { accreditationValidFrom: "2027-01-01T00:00:00.000Z" },
      { accreditationValidUntil: "2026-01-01T00:00:00.000Z" },
      {
        accreditationValidFrom: "2027-01-01T00:00:00.000Z",
        accreditationValidUntil: null,
      },
    ]) {
      expect(UpdateOrganizationProfileSchema.safeParse(window).success).toBe(
        true,
      );
    }
  });
});
