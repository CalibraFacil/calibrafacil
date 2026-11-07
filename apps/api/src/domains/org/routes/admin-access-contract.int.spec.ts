/**
 * admin-access-contract.int.spec.ts: the cloud half of the onboarding, access,
 * sessions and lab-setup endpoint definitions
 * (`packages/contracts/src/endpoints/{onboarding,access,sessions,lab-setup}.ts`).
 * Each client-facing endpoint that does not need Better Auth to send mail is
 * called for real (real handlers, real middleware, real Postgres) and its body
 * is parsed with the response schema of its definition. `mount` also checks
 * each body with that schema in the integration tier
 * (`checkEndpointResponses`), so a drift fails the request itself; the explicit
 * parse here names the drifting path and the status.
 *
 * Not covered here: the magic-link and OTP requests and the claim completion
 * (they go through Better Auth); `lab-setup.int.spec.ts` calls them.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  accessEndpoints,
  labSetupEndpoints,
  onboardingEndpoints,
  sessionEndpoints,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { session as sessionTable } from "@calibra-facil/db/schema";
import { financeAccessRouter } from "../../finance/routes/access";
import { labSetupRouter } from "./lab-setup";
import { onboardingRouter } from "./onboarding";
import { sessionsRouter } from "./sessions";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

describe("onboarding, access, sessions and lab-setup endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("getChecklist answers the steps of a fresh laboratory", async () => {
    const org = await seedOrg({ orgId: "org-onb-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const checklist = await parsedBody(
      await onboardingRouter.request("/checklist"),
      onboardingEndpoints.getChecklist.response,
    );
    expect(checklist.complete).toBe(false);
    expect(checklist.steps.map((step) => step.id)).toContain("customer");
  });

  it("getFinanceAccess answers the member's finance rights", async () => {
    const org = await seedOrg({ orgId: "org-acc-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const access = await parsedBody(
      await financeAccessRouter.request("/"),
      accessEndpoints.getFinanceAccess.response,
    );
    expect(access).toMatchObject({ canManageFinancial: true, role: "admin" });
  });

  it("revoke answers the status of the user's own session", async () => {
    const org = await seedOrg({ orgId: "org-sess-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const now = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(sessionTable).values({
      id: "sess-contract",
      userId: org.userId,
      token: "token-sess-contract",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
    });

    const revoked = await parsedBody(
      await sessionsRouter.request("/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-contract" }),
      }),
      sessionEndpoints.revoke.response,
    );
    expect(revoked.status).toBe(true);
  });

  it("a refused setup token answers 404 with the metadata body the SDK hands back", async () => {
    const refused = await parsedBody(
      await labSetupRouter.request("/not-a-real-token"),
      labSetupEndpoints.get.response,
      404,
    );
    expect(refused.status).toBe("invalid");
  });
});
