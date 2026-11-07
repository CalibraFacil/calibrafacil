import { describe, expect, it } from "vitest";

import { unitEndpoints } from "./units";
import {
  buildOrganizationGovernanceActivityData,
  buildOrganizationGovernanceMembersData,
  buildOrganizationUnit,
  buildOrganizationUnitsData,
  buildUnitsContext,
} from "./units.fixtures";

describe("unit endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      unitEndpoints.getDashboardUnits.response.safeParse(buildUnitsContext())
        .success,
    ).toBe(true);
    expect(
      unitEndpoints.listAdminUnits.response.safeParse(
        buildOrganizationUnitsData(),
      ).success,
    ).toBe(true);
    expect(
      unitEndpoints.listAdminMembers.response.safeParse(
        buildOrganizationGovernanceMembersData(),
      ).success,
    ).toBe(true);
    expect(
      unitEndpoints.listAdminActivity.response.safeParse(
        buildOrganizationGovernanceActivityData(),
      ).success,
    ).toBe(true);
    expect(
      unitEndpoints.createAdminUnit.response.safeParse(buildOrganizationUnit())
        .success,
    ).toBe(true);
  });
});
