import { describe, expect, it } from "vitest";

import { serviceOrderEndpoints } from "./service-orders";
import {
  buildServiceOrderCreateResponse,
  buildServiceOrderDetail,
  buildServiceOrdersListResponse,
} from "./service-orders.fixtures";

describe("service-order endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      serviceOrderEndpoints.list.response.safeParse(
        buildServiceOrdersListResponse(),
      ).success,
    ).toBe(true);
    expect(
      serviceOrderEndpoints.create.response.safeParse(
        buildServiceOrderCreateResponse(),
      ).success,
    ).toBe(true);
    const detail = { data: buildServiceOrderDetail() };
    expect(serviceOrderEndpoints.get.response.safeParse(detail).success).toBe(
      true,
    );
    expect(
      serviceOrderEndpoints.getByPublicId.response.safeParse(detail).success,
    ).toBe(true);
  });
});
