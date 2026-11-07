import { describe, expect, it } from "vitest";

import { dashboardEndpoints } from "./dashboard";
import { buildDashboardJob, buildDashboardStats } from "./dashboard.fixtures";

describe("dashboard endpoint fixtures", () => {
  it("are valid against the response schema of the endpoint", () => {
    const stats = buildDashboardStats({
      recentJobs: [buildDashboardJob()],
      reviewQueue: [buildDashboardJob({ id: 2, status: "REVIEW" })],
      statusBreakdown: [{ status: "REVIEW", count: 1 }],
    });

    expect(dashboardEndpoints.getStats.response.safeParse(stats).success).toBe(
      true,
    );
  });
});
