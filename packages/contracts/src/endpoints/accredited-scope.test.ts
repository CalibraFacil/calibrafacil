import { describe, expect, it } from "vitest";

import { accreditedScopeEndpoints } from "./accredited-scope";
import {
  buildAccreditedScopeLine,
  buildAccreditedScopeResponse,
} from "./accredited-scope.fixtures";

describe("accredited-scope endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      accreditedScopeEndpoints.list.response.safeParse(
        buildAccreditedScopeResponse(),
      ).success,
    ).toBe(true);
    expect(
      accreditedScopeEndpoints.save.response.safeParse({
        message: "Linha de escopo adicionada",
        data: buildAccreditedScopeLine(),
        unit: { unitId: 1, unitName: "Matriz" },
      }).success,
    ).toBe(true);
  });
});
