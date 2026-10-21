/**
 * jobs-tenant-refs.int.spec.ts — Real-DB + real-RBAC integration test for the
 * foreign-id answer of POST /jobs: referencing another tenant's asset must be
 * indistinguishable from referencing an asset that does not exist (no
 * cross-tenant existence oracle on sequential ids). Only the better-auth
 * session is mocked (see test/integration/setup.ts).
 *
 * REQ-TENANT-JOB-001  POST /: org B's assetId answers exactly like a missing id
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobsRouter } from "./jobs";
import { db } from "@calibra-facil/db";
import { calibrationJob } from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };

describe("jobsRouter POST / — foreign asset id", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TENANT-JOB-001 [HIGH RISK]: another org's assetId → same status and body as a non-existent asset, no job created", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
    const foreign = await seedJobForOrg({
      orgId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
    });
    const jobsBefore = await db
      .select({ id: calibrationJob.id })
      .from(calibrationJob);

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const foreignRes = await jobsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        assetId: foreign.assetId,
        serviceId: foreign.serviceId,
      }),
    });
    const missingRes = await jobsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        assetId: 999999,
        serviceId: foreign.serviceId,
      }),
    });

    expect(missingRes.status).toBe(404);
    expect(foreignRes.status).toBe(missingRes.status);
    expect(await foreignRes.json()).toEqual(await missingRes.json());
    const jobsAfter = await db
      .select({ id: calibrationJob.id })
      .from(calibrationJob);
    expect(jobsAfter).toHaveLength(jobsBefore.length);
  });
});
