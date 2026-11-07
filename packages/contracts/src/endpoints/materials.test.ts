import { describe, expect, it } from "vitest";

import { materialEndpoints } from "./materials";
import {
  buildMaterialRecord,
  buildMaterialsListResponse,
} from "./materials.fixtures";

describe("material endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      materialEndpoints.list.response.safeParse(buildMaterialsListResponse())
        .success,
    ).toBe(true);
    expect(
      materialEndpoints.get.response.safeParse(buildMaterialRecord()).success,
    ).toBe(true);
    expect(
      materialEndpoints.deactivate.response.safeParse({
        message: "Material desativado com sucesso",
        data: buildMaterialRecord({ isActive: false }),
      }).success,
    ).toBe(true);
  });
});
