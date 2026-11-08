/**
 * admin-public-contract.int.spec.ts: the cloud half of the public-invitations
 * endpoint definitions (`packages/contracts/src/endpoints/public-invitations.ts`).
 * The endpoints that do not need Better Auth or an outbound mailbox are called
 * for real (real handlers, real Postgres) and their bodies are parsed with the
 * response schema of their definition. `mount` also checks each body with that
 * schema in the integration tier (`checkEndpointResponses`), so a drift fails
 * the request itself; the explicit parse here names the drifting path and the
 * status.
 *
 * Not covered here: the setup link request (it creates users through Better
 * Auth and sends mail); `invitations.int.spec.ts` calls it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { publicInvitationEndpoints } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { invitation } from "@calibra-facil/db/schema";
import { invitationsRouter } from "./invitations";
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

describe("public-invitations endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("get answers what the accept page needs", async () => {
    const org = await seedOrg({ orgId: "org-inv-contract", role: "admin" });
    await db.insert(invitation).values({
      id: "inv-contract",
      organizationId: org.orgId,
      email: "convidado@lab.test",
      role: "technician",
      status: "pending",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      inviterId: org.userId,
    });

    const found = await parsedBody(
      await invitationsRouter.request("/inv-contract"),
      publicInvitationEndpoints.get.response,
    );
    expect(found).toMatchObject({
      id: "inv-contract",
      email: "convidado@lab.test",
      organizationId: org.orgId,
    });
  });
});
