import { describe, expect, it } from "vitest";

import { AddVisitJobSchema } from "./index";

describe("AddVisitJobSchema — REQ-VISITJOB-011", () => {
  it("accepts a valid body with positive assetId and serviceId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: 1, serviceId: 2 }).success,
    ).toBe(true);
  });

  it("rejects missing assetId", () => {
    expect(AddVisitJobSchema.safeParse({ serviceId: 2 }).success).toBe(false);
  });

  it("rejects missing serviceId", () => {
    expect(AddVisitJobSchema.safeParse({ assetId: 1 }).success).toBe(false);
  });

  it("rejects zero assetId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: 0, serviceId: 2 }).success,
    ).toBe(false);
  });

  it("rejects negative assetId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: -5, serviceId: 2 }).success,
    ).toBe(false);
  });

  it("rejects zero serviceId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: 1, serviceId: 0 }).success,
    ).toBe(false);
  });

  it("rejects negative serviceId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: 1, serviceId: -10 }).success,
    ).toBe(false);
  });

  it("rejects non-integer assetId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: 1.5, serviceId: 2 }).success,
    ).toBe(false);
  });

  it("rejects non-integer serviceId", () => {
    expect(
      AddVisitJobSchema.safeParse({ assetId: 1, serviceId: 2.7 }).success,
    ).toBe(false);
  });
});
