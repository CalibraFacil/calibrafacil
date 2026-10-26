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
      cnpj: "1",
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
});
