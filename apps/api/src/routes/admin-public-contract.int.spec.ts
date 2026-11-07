/**
 * admin-public-contract.int.spec.ts: the cloud half of the public-signup and
 * public-invitations endpoint definitions
 * (`packages/contracts/src/endpoints/{public-signup,public-invitations}.ts`).
 * The endpoints that do not need Better Auth or an outbound mailbox are called
 * for real (real handlers, real Postgres) and their bodies are parsed with the
 * response schema of their definition. `mount` also checks each body with that
 * schema in the integration tier (`checkEndpointResponses`), so a drift fails
 * the request itself; the explicit parse here names the drifting path and the
 * status.
 *
 * Not covered here: the sign-up that provisions an account and the setup link
 * request (they create users through Better Auth and send mail);
 * `invitations.int.spec.ts` calls the latter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  publicInvitationEndpoints,
  publicSignupEndpoints,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { invitation } from "@calibra-facil/db/schema";
import { invitationsRouter } from "./invitations";
import { publicSignupRouter } from "./public-signup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

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

describe("public-signup endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("start answers the success shape to the honeypot, with the no-cache headers", async () => {
    const response = await publicSignupRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ana Souza",
        email: "ana@laboratorio-exemplo.com.br",
        labName: "Laboratório Exemplo",
        cnpj: "11.222.333/0001-81",
        website: "http://spam.example",
      }),
    });

    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await parsedBody(
      response,
      publicSignupEndpoints.start.response,
    );
    expect(body.ok).toBe(true);
  });
});
