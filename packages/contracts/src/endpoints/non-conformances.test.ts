import { describe, expect, it } from "vitest";

import { nonConformanceEndpoints } from "./non-conformances";
import {
  buildNonConformanceListItem,
  buildNonConformanceListResponse,
  buildNonConformanceRecord,
} from "./non-conformances.fixtures";

describe("non-conformance endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      nonConformanceEndpoints.list.response.safeParse(
        buildNonConformanceListResponse([
          buildNonConformanceListItem(),
          buildNonConformanceListItem({ id: 2, disposition: "rework" }),
        ]),
      ).success,
    ).toBe(true);
    expect(
      nonConformanceEndpoints.create.response.safeParse(
        buildNonConformanceRecord(),
      ).success,
    ).toBe(true);
    expect(
      nonConformanceEndpoints.summary.response.safeParse({
        byStatus: [{ status: "open", count: 1 }],
        byType: [{ type: "work", count: 1 }],
        ageBrackets: { lessThan7Days: 1, moreThan30Days: 0 },
      }).success,
    ).toBe(true);
  });
});
