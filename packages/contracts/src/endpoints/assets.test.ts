import { describe, expect, it } from "vitest";

import { assetEndpoints } from "./assets";
import {
  buildAssetDetail,
  buildAssetRecord,
  buildAssetsListResponse,
} from "./assets.fixtures";

describe("asset endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      assetEndpoints.list.response.safeParse(buildAssetsListResponse()).success,
    ).toBe(true);
    expect(
      assetEndpoints.get.response.safeParse(buildAssetDetail()).success,
    ).toBe(true);
    expect(
      assetEndpoints.create.response.safeParse(buildAssetRecord()).success,
    ).toBe(true);
    expect(
      assetEndpoints.update.response.safeParse(buildAssetRecord()).success,
    ).toBe(true);
  });
});
