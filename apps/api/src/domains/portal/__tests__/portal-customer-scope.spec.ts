import { describe, expect, it } from "vitest";
import { applyUnitFilter } from "../portal-customer-scope";

describe("applyUnitFilter", () => {
  const groupScope = {
    mode: "group" as const,
    groupId: 3,
    customerIds: [10, 11],
    customerById: new Map(),
    labOrganizationId: "lab-1",
  };

  it("returns all customers when no unit is requested", () => {
    expect(applyUnitFilter(groupScope, undefined)).toEqual([10, 11]);
  });

  it("narrows to a single in-scope unit", () => {
    expect(applyUnitFilter(groupScope, 11)).toEqual([11]);
  });

  it("returns empty for an out-of-scope unit", () => {
    expect(applyUnitFilter(groupScope, 999)).toEqual([]);
  });
});
