import { describe, expect, it } from "vitest";

import { keepPreviousDataInScope } from "./query-scope";

describe("keepPreviousDataInScope", () => {
  const placeholder = keepPreviousDataInScope<string[]>(["jobs", "org-a"]);

  it("keeps the previous rows while the same list pages or filters", () => {
    expect(
      placeholder(["row"], { queryKey: ["jobs", "org-a", { page: 1 }] }),
    ).toEqual(["row"]);
  });

  it("drops them across an organization switch", () => {
    expect(
      placeholder(["row"], { queryKey: ["jobs", "org-b", { page: 1 }] }),
    ).toBeUndefined();
  });

  it("has nothing to keep without a previous query", () => {
    expect(placeholder(["row"], undefined)).toBeUndefined();
  });
});
