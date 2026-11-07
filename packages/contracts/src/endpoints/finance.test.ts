import { describe, expect, it } from "vitest";

import { financeEndpoints } from "./finance";

describe("finance endpoint queries", () => {
  it("reads the readiness, stage and limit filters leniently (the handlers parse them)", () => {
    expect(
      financeEndpoints.listBillingReadiness.query?.safeParse({
        status: "NOT_A_STATUS",
        customerId: "abc",
      }).success,
    ).toBe(true);
    expect(
      financeEndpoints.getOperationsToCash.query?.safeParse({ stage: "x" })
        .success,
    ).toBe(true);
  });
});
