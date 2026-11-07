import { describe, expect, it } from "vitest";

import { customerEndpoints } from "./customers";
import {
  buildCustomerDetail,
  buildCustomerRecord,
  buildCustomersListResponse,
} from "./customers.fixtures";
import { ENDPOINT_GROUPS, endpointLabel, endpointPolicies } from "./index";

describe("customer endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      customerEndpoints.list.response.safeParse(buildCustomersListResponse())
        .success,
    ).toBe(true);
    expect(
      customerEndpoints.get.response.safeParse(buildCustomerDetail()).success,
    ).toBe(true);
    expect(
      customerEndpoints.update.response.safeParse(buildCustomerRecord())
        .success,
    ).toBe(true);
  });
});

describe("endpoint definitions", () => {
  it("never repeat a method and path inside the registry", () => {
    const labels = Object.values(ENDPOINT_GROUPS).flatMap((group) =>
      Object.values(group).map((def) => endpointLabel(def)),
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("give every cloud-only endpoint a desktop label", () => {
    for (const group of Object.values(ENDPOINT_GROUPS)) {
      for (const def of Object.values(group)) {
        if (def.policy === "cloud-only") {
          expect(def.desktopLabel.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("derive the policy map of a group from its entries", () => {
    expect(endpointPolicies(customerEndpoints)).toMatchObject({
      list: "local-first-read-through-sync",
      get: "local-first-read-through-sync",
      create: "cloud-only",
      lookupCnpj: "cloud-only",
    });
  });
});
