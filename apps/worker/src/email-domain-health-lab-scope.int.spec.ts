import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { organizationEmailDomain } from "@calibra-facil/db/schema";
import { createRoleDatabase } from "@calibra-facil/db/role-connection";
import { processEmailDomainHealth } from "@calibra-facil/jobs-core/email-domain-health";
import { db, truncateAll } from "../test/integration/db";
import {
  asString,
  field,
  ownerDatabaseUrl,
  toRows,
} from "../test/integration/application-role";
import { seedOrg } from "../test/integration/seed";

/**
 * The e-mail sender-domain health sweep as `calibra_app` (P2-18j). The sweep
 * lists every laboratory's domain in ONE statement on the system connection
 * (the owner); each row's update and its audit event then commit together in
 * one short transaction that names the row's own laboratory, after the Resend
 * round-trip and never around it.
 *
 *   REQ-WRLS-EDH-1  each laboratory's domain is refreshed from ITS Resend verdict, as calibra_app
 *                   (a verified domain and a revoked key, in two laboratories, in one sweep)
 *   REQ-WRLS-EDH-2  each audit event is written in the laboratory that owns the domain, with its update
 *   REQ-WRLS-EDH-3  no transaction is open while the provider is called
 */

const openRoleDatabases: Array<{ close: () => Promise<void> }> = [];

async function seedDomain(params: {
  orgId: string;
  userId: string;
  resendDomainId: string;
  verified: boolean;
}) {
  await db.insert(organizationEmailDomain).values({
    id: `dom-${params.orgId}`,
    organizationId: params.orgId,
    mode: "managed",
    hostname: `${params.orgId}.example.test`,
    resendDomainId: params.resendDomainId,
    fromAddress: `os@${params.orgId}.example.test`,
    status: params.verified ? "verified" : "pending",
    verifiedAt: params.verified ? new Date("2026-01-01T00:00:00.000Z") : null,
    createdBy: params.userId,
  });
}

async function domainRow(orgId: string) {
  const row = toRows(
    await db.execute(
      sql`SELECT status, key_status, key_last_error, verified_at
          FROM organization_email_domain WHERE organization_id = ${orgId}`,
    ),
  )[0];
  return {
    status: asString(field(row, "status")),
    keyStatus: asString(field(row, "key_status")),
    keyLastError: field(row, "key_last_error"),
    verifiedAt: field(row, "verified_at"),
  };
}

async function events() {
  return toRows(
    await db.execute(
      sql`SELECT organization_id, action, entity_id FROM organization_event_log
          ORDER BY organization_id, id`,
    ),
  ).map((row) => ({
    organizationId: asString(field(row, "organization_id")),
    action: asString(field(row, "action")),
    entityId: asString(field(row, "entity_id")),
  }));
}

beforeEach(async () => {
  await truncateAll();
  vi.stubEnv("RESEND_API_KEY", "re_platform_test_key");
  vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(openRoleDatabases.splice(0).map((open) => open.close()));
});

describe("e-mail domain health sweep as calibra_app (P2-18j)", () => {
  it("REQ-WRLS-EDH-1 REQ-WRLS-EDH-2 REQ-WRLS-EDH-3 [HIGH RISK] each domain is refreshed from its own verdict, its event written in its own laboratory, with no transaction open during the provider call", async () => {
    const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
    const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
    await seedDomain({
      orgId: orgA.orgId,
      userId: orgA.userId,
      resendDomainId: "resend-A",
      verified: false,
    });
    await seedDomain({
      orgId: orgB.orgId,
      userId: orgB.userId,
      resendDomainId: "resend-B",
      verified: true,
    });
    const openTransactions: number[] = [];
    // The Resend API is the only thing `fetch` is used for here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const rows = toRows(
          await db.execute(
            sql`SELECT count(*)::int AS open FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND state LIKE 'idle in transaction%'`,
          ),
        );
        openTransactions.push(Number(field(rows[0], "open")));
        const headers = { "content-type": "application/json" };
        if (String(input).endsWith("/domains/resend-A")) {
          return new Response(
            JSON.stringify({
              object: "domain",
              id: "resend-A",
              name: "org-A.example.test",
              status: "verified",
              records: [],
            }),
            { status: 200, headers },
          );
        }
        return new Response(
          JSON.stringify({
            name: "restricted_api_key",
            message: "API key is invalid",
            statusCode: 401,
          }),
          { status: 401, headers },
        );
      }),
    );
    const application = createRoleDatabase(ownerDatabaseUrl(), {
      role: "calibra_app",
      max: 1,
    });
    openRoleDatabases.push(application);

    const result = await processEmailDomainHealth({
      application: application.db,
      system: db,
    });

    expect(result).toEqual({
      checked: 2,
      verified: 1,
      unverified: 0,
      keyInvalid: 1,
      skipped: 0,
    });
    const a = await domainRow("org-A");
    expect(a.status).toBe("verified");
    expect(a.verifiedAt).not.toBeNull();
    expect(a.keyStatus).toBe("ok");
    const b = await domainRow("org-B");
    expect(b.keyStatus).toBe("invalid");
    expect(asString(b.keyLastError)).toContain("API key is invalid");

    expect(await events()).toEqual([
      {
        organizationId: "org-A",
        action: "email_sender_domain.verified",
        entityId: "dom-org-A",
      },
      {
        organizationId: "org-B",
        action: "email_sender_domain.key_failed",
        entityId: "dom-org-B",
      },
    ]);
    expect(openTransactions).toEqual([0, 0]);
  });
});
