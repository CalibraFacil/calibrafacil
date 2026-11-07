/**
 * api-key-auth.int.spec.ts — real-Postgres proof of the API-key rules of roadmap 2
 * D3 (review 3.3), through the real `requireApiKeyAuth` middleware.
 *
 *   REQ-D3-1  an expired key is refused (401); a key without an expiry (made
 *             before expiry existed) still works
 *   REQ-D3-2  a key bound to addresses is refused from any other address (403)
 *             and accepted from one inside a listed range
 *   REQ-D3-3  a key acts for its creator's LIVE role: once the creator is no
 *             longer an owner/admin of the laboratory (demoted or gone) the key is
 *             refused (401)
 *   REQ-D3-4  `last_used_at` is written once per few minutes, not per request
 *   REQ-D3-5  creating a key sets a 365-day expiry by default and stores the
 *             allowlist; an invalid range is refused
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { member, organizationApiKey } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { createApiKeySecret } from "../lib/api-keys";
import { truncateAll } from "../../test/integration/db";
import { loginAs } from "../../test/integration/setup";
import { seedOrg } from "../../test/integration/seed";
import { apiKeysRouter } from "../routes/api-keys";
import { requireApiKeyAuth } from "./api-key-auth";

const app = new Hono()
  .use("*", requireApiKeyAuth)
  .get("/probe", (c) => c.json({ ok: true }));

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedKey(
  org: { orgId: string; userId: string },
  values: Partial<typeof organizationApiKey.$inferInsert> = {},
) {
  const secret = createApiKeySecret();
  const id = crypto.randomUUID();
  await db.insert(organizationApiKey).values({
    id,
    organizationId: org.orgId,
    name: "ERP",
    keyPrefix: secret.keyPrefix,
    keyHash: secret.keyHash,
    scopes: ["customers:read"],
    createdBy: org.userId,
    ...values,
  });
  return { id, rawKey: secret.key };
}

function probe(rawKey: string, remoteAddress = "203.0.113.50") {
  return app.request(
    "/probe",
    { headers: { "x-api-key": rawKey } },
    { REMOTE_ADDRESS: remoteAddress },
  );
}

async function lastUse(id: string) {
  const [row] = await db
    .select({
      at: organizationApiKey.lastUsedAt,
      ip: organizationApiKey.lastUsedIp,
    })
    .from(organizationApiKey)
    .where(eq(organizationApiKey.id, id));
  return row;
}

describe("requireApiKeyAuth (roadmap 2 D3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-D3-1: an expired key is refused; a key without an expiry still works", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const expired = await seedKey(org, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const current = await seedKey(org, {
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    const legacy = await seedKey(org);

    expect((await probe(expired.rawKey)).status).toBe(401);
    expect((await probe(current.rawKey)).status).toBe(200);
    expect((await probe(legacy.rawKey)).status).toBe(200);
  });

  it("REQ-D3-2 [HIGH RISK]: a key bound to addresses is refused from elsewhere and accepted inside a listed range", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const bound = await seedKey(org, {
      allowedIps: ["198.51.100.0/24", "2001:db8::1"],
    });

    expect((await probe(bound.rawKey, "203.0.113.50")).status).toBe(403);
    expect((await probe(bound.rawKey, "198.51.100.7")).status).toBe(200);
    expect((await probe(bound.rawKey, "::ffff:198.51.100.8")).status).toBe(200);
    expect((await probe(bound.rawKey, "2001:db8::1")).status).toBe(200);
  });

  it("REQ-D3-3 [HIGH RISK]: the key follows its creator's live role (demoted or gone: refused)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const key = await seedKey(org);
    expect((await probe(key.rawKey)).status).toBe(200);

    await db
      .update(member)
      .set({ role: "technician" })
      .where(
        and(
          eq(member.organizationId, org.orgId),
          eq(member.userId, org.userId),
        ),
      );
    expect((await probe(key.rawKey)).status).toBe(401);

    await db.delete(member).where(eq(member.userId, org.userId));
    expect((await probe(key.rawKey)).status).toBe(401);
  });

  it("REQ-D3-4: last_used_at is written on the first use, not again within minutes from the same address", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const key = await seedKey(org);

    await probe(key.rawKey, "203.0.113.50");
    const first = await lastUse(key.id);
    expect(first?.ip).toBe("203.0.113.50");
    expect(first?.at).toBeInstanceOf(Date);

    await probe(key.rawKey, "203.0.113.50");
    expect((await lastUse(key.id))?.at).toEqual(first?.at);

    // A new address is recorded at once.
    await probe(key.rawKey, "203.0.113.51");
    expect((await lastUse(key.id))?.ip).toBe("203.0.113.51");
  });

  it("REQ-D3-5: a new key expires in 365 days by default and keeps its allowlist; an invalid range is refused", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const created = await apiKeysRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "ERP integration",
        allowedIps: ["198.51.100.0/24"],
      }),
    });
    expect(created.status).toBe(201);
    const body: { key: { id: string } } = await created.json();
    const [row] = await db
      .select({
        expiresAt: organizationApiKey.expiresAt,
        allowedIps: organizationApiKey.allowedIps,
      })
      .from(organizationApiKey)
      .where(eq(organizationApiKey.id, body.key.id));
    const days = ((row?.expiresAt?.getTime() ?? 0) - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThanOrEqual(365);
    expect(row?.allowedIps).toEqual(["198.51.100.0/24"]);

    const invalid = await apiKeysRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bad", allowedIps: ["not-an-ip"] }),
    });
    expect(invalid.status).toBe(400);
  });
});
