import { describe, expect, it } from "vitest";

import { proficiencyTestEndpoints } from "./proficiency-tests";
import {
  buildPtDetail,
  buildPtListResponse,
  buildPtPlanItem,
  buildPtSummary,
} from "./proficiency-tests.fixtures";

describe("proficiency-test endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      proficiencyTestEndpoints.list.response.safeParse(buildPtListResponse())
        .success,
    ).toBe(true);
    expect(
      proficiencyTestEndpoints.get.response.safeParse(buildPtDetail()).success,
    ).toBe(true);
    expect(
      proficiencyTestEndpoints.get.response.safeParse(
        buildPtDetail({ results: null }),
      ).success,
    ).toBe(true);
    expect(
      proficiencyTestEndpoints.summary.response.safeParse(buildPtSummary())
        .success,
    ).toBe(true);
    expect(
      proficiencyTestEndpoints.listPlan.response.safeParse({
        data: [buildPtPlanItem()],
      }).success,
    ).toBe(true);
  });
});
