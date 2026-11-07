import { describe, expect, it } from "vitest";

import { financeEndpoints } from "./finance";
import {
  buildBillingDocumentListItem,
  buildCashForecast,
  buildFinanceOverview,
} from "./finance.fixtures";

describe("finance endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      financeEndpoints.listDocuments.response.safeParse({
        data: [buildBillingDocumentListItem()],
      }).success,
    ).toBe(true);
    expect(
      financeEndpoints.getOverview.response.safeParse(buildFinanceOverview())
        .success,
    ).toBe(true);
    expect(
      financeEndpoints.getCashForecast.response.safeParse(buildCashForecast())
        .success,
    ).toBe(true);
  });

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
