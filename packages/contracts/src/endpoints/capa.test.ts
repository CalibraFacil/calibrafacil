import { describe, expect, it } from "vitest";

import { capaEndpoints } from "./capa";
import { buildCorrectiveActionRow } from "./capa.fixtures";

describe("capa endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      capaEndpoints.create.response.safeParse(buildCorrectiveActionRow())
        .success,
    ).toBe(true);
    expect(
      capaEndpoints.close.response.safeParse({
        message: "CAPA fechada com sucesso",
        data: buildCorrectiveActionRow({ status: "CLOSED" }),
      }).success,
    ).toBe(true);
    expect(
      capaEndpoints.summary.response.safeParse({
        byStatus: [{ status: "OPEN", count: 1 }],
        bySeverity: [{ severity: "major", count: 1 }],
        byCategory: [{ category: "method", count: 1 }],
        overdue: 0,
        effectivenessRate: 0,
        totalClosed: 0,
      }).success,
    ).toBe(true);
  });
});
