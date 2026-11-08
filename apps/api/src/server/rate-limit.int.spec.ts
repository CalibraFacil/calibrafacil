/**
 * The request limiter in the real app: it counts a credential on its own only
 * after the authentication middleware accepted it. A caller that rotates fake
 * API keys stays on its address's counter and is answered 429 whatever the
 * values are; a real key then has a counter of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { organizationApiKey } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { createApiKeySecret } from "../lib/api-keys";
import { createApiApp } from "../app";

const ENV = {
  NODE_ENV: "test",
  REMOTE_ADDRESS: "203.0.113.50",
};

async function seedKey(orgId: string, userId: string, keyId: string) {
  const { key, keyPrefix, keyHash } = createApiKeySecret();
  await db.insert(organizationApiKey).values({
    id: keyId,
    organizationId: orgId,
    name: keyId,
    keyPrefix,
    keyHash,
    scopes: ["customers:read"],
    createdBy: userId,
  });
  return key;
}

function get(app: ReturnType<typeof createApiApp>, apiKey: string) {
  return app.request(
    "/api/public/v2/customers",
    { method: "GET", headers: { "x-api-key": apiKey } },
    ENV,
  );
}

describe("request rate limit in the real app", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("API_RATE_LIMIT_PER_MINUTE", "3");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 429 to a caller that rotates fake API keys from one address", async () => {
    const app = createApiApp();
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await get(app, `ck_fake_${index}`)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it("gives an accepted API key a counter of its own, apart from the address's", async () => {
    const org = await seedOrg({ orgId: "org-rl" });
    const keyA = await seedKey(org.orgId, org.userId, "key-rl-a");
    const keyB = await seedKey(org.orgId, org.userId, "key-rl-b");
    const app = createApiApp();

    // The first request is counted on the address (the key is not proven yet),
    // the next three on the key itself, the fifth is over.
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await get(app, keyA)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429]);

    // Another key of the same address is its own caller.
    expect((await get(app, keyB)).status).toBe(200);
  });
});
