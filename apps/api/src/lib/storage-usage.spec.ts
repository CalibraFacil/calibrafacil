import { describe, it, expect } from "vitest";

import { sumStorageUsageForOrganization } from "./storage-usage";

// REQ-DOM-STG-001: getStorageUsage must return the org's REAL total bytes.
// The DB wrapper (getOrganizationStorageBytes) selects (organizationId, bytes)
// refs from every size-tracked source table and delegates the arithmetic to
// this pure aggregator, so the aggregator is where the summing + tenant-scoping
// contract is proven.
describe("sumStorageUsageForOrganization", () => {
  it("REQ-DOM-STG-001: sums the byte sizes of every stored object for the org", () => {
    const rows = [
      { organizationId: "org-a", bytes: 100 },
      { organizationId: "org-a", bytes: 250 },
      { organizationId: "org-a", bytes: 1_048_576 },
    ];

    expect(sumStorageUsageForOrganization("org-a", rows)).toBe(1_048_926);
  });

  it("REQ-DOM-STG-001: counts only the requested org's objects (tenant scoping)", () => {
    const rows = [
      { organizationId: "org-a", bytes: 500 },
      { organizationId: "org-b", bytes: 9_000 },
      { organizationId: "org-a", bytes: 500 },
    ];

    expect(sumStorageUsageForOrganization("org-a", rows)).toBe(1_000);
    expect(sumStorageUsageForOrganization("org-b", rows)).toBe(9_000);
  });

  it("REQ-DOM-STG-001: returns 0 for an org with no stored objects", () => {
    const rows = [{ organizationId: "org-a", bytes: 500 }];

    expect(sumStorageUsageForOrganization("empty-org", rows)).toBe(0);
    expect(sumStorageUsageForOrganization("empty-org", [])).toBe(0);
  });

  it("REQ-DOM-STG-001: ignores non-finite or negative sizes instead of corrupting the total", () => {
    const rows = [
      { organizationId: "org-a", bytes: 1_000 },
      { organizationId: "org-a", bytes: Number.NaN },
      { organizationId: "org-a", bytes: -50 },
      { organizationId: "org-a", bytes: Number.POSITIVE_INFINITY },
    ];

    expect(sumStorageUsageForOrganization("org-a", rows)).toBe(1_000);
  });
});
