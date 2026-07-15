import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real-DB + real-RBAC integration tests for emailDomainsRouter (issue #584).
//
// Only the better-auth lab session is mocked (test/integration/setup.ts) and
// the three Resend-touching wrapper functions are mocked at the package
// boundary — encryption, serialization, guards and persistence all run for
// real against the seeded Postgres.
//
//   GET  /              requireLabProtected + requireOrgType("LAB")
//   POST /validate-key  withLabPermission + requireRole(admin/owner)
//                       + requireFeature("email_sender_domain")
//   POST /              same
//   POST /key           same
//   POST /verify        same
//   POST /activate      same
//   DELETE /            withLabPermission + requireRole (NO requireFeature)
//
// Covered:
//   REQ-ED-001 [HIGH RISK]  GET / read isolation across orgs
//   REQ-ED-002 [HIGH RISK]  manage gate — member -> 403; admin -> success
//   REQ-ED-003 [HIGH RISK]  cross-tenant DELETE is a no-op
//   REQ-ED-004              unauthenticated -> 401
//   REQ-ED-005 [HIGH RISK]  the raw API key NEVER appears in any response,
//                           and is stored encrypted (not plaintext) at rest
//   REQ-ED-006              feature gate — FREE org (no subscription) -> 403
//   ED happy-path           pick verified domain -> activate -> active summary

const validateResendApiKeyMock = vi.hoisted(() => vi.fn());
const getResendDomainMock = vi.hoisted(() => vi.fn());
const verifyResendDomainMock = vi.hoisted(() => vi.fn());

vi.mock("@calibra-facil/email-sender", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@calibra-facil/email-sender")>();
  return {
    ...actual,
    validateResendApiKey: validateResendApiKeyMock,
    getResendDomain: getResendDomainMock,
    verifyResendDomain: verifyResendDomainMock,
  };
});

import { emailDomainsRouter } from "./email-domains";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationEmailDomain,
  subscription,
} from "@calibra-facil/db/schema";
import {
  encryptResendApiKey,
  generateEmailDomainMasterKey,
  resendApiKeyLast4,
} from "@calibra-facil/email-sender";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };
const RAW_KEY = "re_secret_test_key_abcd1234";
const MASTER_KEY = generateEmailDomainMasterKey();

/** STANDARD includes email_sender_domain (deliberately lower tier than
 * custom_domain, which is Professional+). */
async function seedStandardSubscription(organizationId: string): Promise<void> {
  await db.insert(subscription).values({
    organizationId,
    planId: "STANDARD",
    status: "ACTIVE",
    renewalMode: "NONE",
    currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
  });
}

async function seedEmailDomain(params: {
  organizationId: string;
  createdBy: string;
  hostname: string;
  verified?: boolean;
  isActive?: boolean;
}): Promise<string> {
  const id = `emaildom-${params.organizationId}`;
  const encrypted = encryptResendApiKey(RAW_KEY, MASTER_KEY);
  const verifiedAt = params.verified ? new Date() : null;
  await db.insert(organizationEmailDomain).values({
    id,
    organizationId: params.organizationId,
    hostname: params.hostname,
    resendDomainId: `rd-${params.organizationId}`,
    resendApiKeyEncrypted: encrypted.encrypted,
    resendApiKeyIv: encrypted.iv,
    resendApiKeyLast4: resendApiKeyLast4(RAW_KEY),
    fromAddress: `os@${params.hostname}`,
    status: params.verified ? "verified" : "pending",
    verifiedAt,
    lastVerifiedAt: verifiedAt,
    isActive: params.isActive ?? false,
    createdBy: params.createdBy,
  });
  return id;
}

describe("emailDomainsRouter — real DB + real middleware (LAB router)", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", MASTER_KEY);
    validateResendApiKeyMock.mockReset();
    getResendDomainMock.mockReset();
    verifyResendDomainMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // REQ-ED-001 [HIGH RISK]: read isolation — the org-scope WHERE in
  // getOrganizationEmailDomain is the sole tenant discriminator.
  it("REQ-ED-001: GET / returns only the authenticated org's domain", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedEmailDomain({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      hostname: "mail.lab-a.example.com",
    });
    await seedEmailDomain({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      hostname: "mail.lab-b.example.com",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await emailDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.hostname).toBe("mail.lab-a.example.com");
    expect(JSON.stringify(body)).not.toContain("mail.lab-b.example.com");
  });

  // REQ-ED-002 [HIGH RISK]: manage gate. member -> 403 on every mutating
  // route; admin with the entitlement succeeds and the row persists.
  it("REQ-ED-002: member is denied all mutations (403); admin succeeds + persists", async () => {
    const memberOrg = await seedOrg({ orgId: "org-m", role: "member" });
    await seedStandardSubscription(memberOrg.orgId);
    loginAs({ userId: memberOrg.userId, organizationId: memberOrg.orgId });

    const mutations: Array<[string, string]> = [
      ["POST", "/validate-key"],
      ["POST", "/"],
      ["POST", "/key"],
      ["POST", "/verify"],
      ["POST", "/activate"],
      ["DELETE", "/"],
    ];
    const results = await Promise.all(
      mutations.map(async ([method, path]) => {
        const res = await emailDomainsRouter.request(path, {
          method,
          headers: JSON_HEADERS,
          body:
            method === "DELETE"
              ? undefined
              : JSON.stringify({
                  apiKey: RAW_KEY,
                  resendDomainId: "rd-1",
                  fromLocalPart: "os",
                }),
        });
        return { method, path, status: res.status };
      }),
    );
    for (const { method, path, status } of results) {
      expect(status, `${method} ${path}`).toBe(403);
    }

    const afterMember = await db
      .select()
      .from(organizationEmailDomain)
      .where(eq(organizationEmailDomain.organizationId, memberOrg.orgId));
    expect(afterMember).toHaveLength(0);

    // --- admin succeeds ---
    const adminOrg = await seedOrg({ orgId: "org-admin", role: "admin" });
    await seedStandardSubscription(adminOrg.orgId);
    loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });

    getResendDomainMock.mockResolvedValue({
      ok: true,
      data: {
        id: "rd-admin",
        name: "mail.lab-admin.example.com",
        status: "verified",
        records: [
          {
            record: "DKIM",
            name: "resend._domainkey",
            type: "TXT",
            value: "k=...",
          },
        ],
      },
    });

    const add = await emailDomainsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        apiKey: RAW_KEY,
        resendDomainId: "rd-admin",
        fromLocalPart: "OS",
      }),
    });
    expect(add.status).toBe(201);
    const created = await add.json();
    expect(created.domain.hostname).toBe("mail.lab-admin.example.com");
    expect(created.domain.fromAddress).toBe("os@mail.lab-admin.example.com");
    expect(created.statusSummary.status).toBe("verified");
    expect(created.statusSummary.canActivate).toBe(true);

    const rows = await db
      .select()
      .from(organizationEmailDomain)
      .where(eq(organizationEmailDomain.organizationId, adminOrg.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hostname).toBe("mail.lab-admin.example.com");
  });

  // REQ-ED-003 [HIGH RISK]: no per-id param exists; a scoped lookup for org A
  // resolves nothing, so org B's row must survive org A's DELETE.
  it("REQ-ED-003: org A's DELETE never reaches another org's domain", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bDomainId = await seedEmailDomain({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      hostname: "mail.lab-b.example.com",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await emailDomainsRouter.request("/", {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(200);

    const bRows = await db
      .select()
      .from(organizationEmailDomain)
      .where(eq(organizationEmailDomain.id, bDomainId));
    expect(bRows).toHaveLength(1);
  });

  // ED reply-to: replies are the point of the feature (customers answer OS/
  // quote mail with purchase orders). Reply-To rides organization.email; GET
  // exposes it so the settings UI can warn when replies would be lost.
  it("ED reply-to: GET exposes organization.email as the reply destination (null when unset)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const before = await emailDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(before.status).toBe(200);
    expect((await before.json()).replyToEmail).toBeNull();

    await db
      .update(organization)
      .set({ email: "contato@lab-a.com.br" })
      .where(eq(organization.id, org.orgId));

    const after = await emailDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(after.status).toBe(200);
    expect((await after.json()).replyToEmail).toBe("contato@lab-a.com.br");
  });

  // REQ-ED-004: unauthenticated -> 401.
  it("REQ-ED-004: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await emailDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // REQ-ED-005 [HIGH RISK]: key custody. The raw key never appears in any
  // response (masked last-4 only) and is not stored in plaintext.
  it("REQ-ED-005: the raw API key never leaks through responses and is encrypted at rest", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedStandardSubscription(org.orgId);
    loginAs({ userId: org.userId, organizationId: org.orgId });

    getResendDomainMock.mockResolvedValue({
      ok: true,
      data: {
        id: "rd-1",
        name: "mail.custody.example.com",
        status: "verified",
        records: [],
      },
    });
    verifyResendDomainMock.mockResolvedValue({
      ok: true,
      data: { id: "rd-1" },
    });

    const responses = [
      await emailDomainsRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          apiKey: RAW_KEY,
          resendDomainId: "rd-1",
          fromLocalPart: "os",
        }),
      }),
      await emailDomainsRouter.request("/", { headers: JSON_HEADERS }),
      await emailDomainsRouter.request("/verify", {
        method: "POST",
        headers: JSON_HEADERS,
      }),
      await emailDomainsRouter.request("/activate", {
        method: "POST",
        headers: JSON_HEADERS,
      }),
      await emailDomainsRouter.request("/key", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ apiKey: RAW_KEY }),
      }),
    ];

    const bodies = await Promise.all(responses.map((res) => res.text()));
    for (const text of bodies) {
      expect(text).not.toContain(RAW_KEY);
    }

    const [row] = await db
      .select()
      .from(organizationEmailDomain)
      .where(eq(organizationEmailDomain.organizationId, org.orgId));
    expect(row).toBeDefined();
    expect(row?.resendApiKeyEncrypted).not.toContain(RAW_KEY);
    expect(row?.resendApiKeyLast4).toBe(RAW_KEY.slice(-4));
  });

  // REQ-ED-006 [HIGH RISK]: feature gate. FREE (no subscription row) lacks
  // email_sender_domain -> requireFeature answers 403.
  it("REQ-ED-006: org without the entitlement is blocked by the feature gate", async () => {
    const org = await seedOrg({ orgId: "org-free", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await emailDomainsRouter.request("/validate-key", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ apiKey: RAW_KEY }),
    });
    expect(res.status).toBe(403);
    expect(validateResendApiKeyMock).not.toHaveBeenCalled();
  });

  // Happy path: pick a verified domain -> activate -> active summary; a
  // pending domain cannot be activated.
  it("ED happy-path: pick verified domain, activate, and block activation while pending", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedStandardSubscription(org.orgId);
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Pending domain first: cannot activate.
    getResendDomainMock.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "rd-1",
        name: "mail.flow.example.com",
        status: "pending",
        records: [],
      },
    });
    const addPending = await emailDomainsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        apiKey: RAW_KEY,
        resendDomainId: "rd-1",
        fromLocalPart: "os",
      }),
    });
    expect(addPending.status).toBe(201);
    const pendingBody = await addPending.json();
    expect(pendingBody.statusSummary.status).toBe("waiting_verification");

    const blockedActivate = await emailDomainsRouter.request("/activate", {
      method: "POST",
      headers: JSON_HEADERS,
    });
    expect(blockedActivate.status).toBe(400);

    // Verify: Resend now reports verified.
    verifyResendDomainMock.mockResolvedValue({
      ok: true,
      data: { id: "rd-1" },
    });
    getResendDomainMock.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "rd-1",
        name: "mail.flow.example.com",
        status: "verified",
        records: [],
      },
    });
    const verify = await emailDomainsRouter.request("/verify", {
      method: "POST",
      headers: JSON_HEADERS,
    });
    expect(verify.status).toBe(200);
    const verifyBody = await verify.json();
    expect(verifyBody.statusSummary.status).toBe("verified");
    expect(verifyBody.statusSummary.canActivate).toBe(true);

    const activate = await emailDomainsRouter.request("/activate", {
      method: "POST",
      headers: JSON_HEADERS,
    });
    expect(activate.status).toBe(200);
    const activeBody = await activate.json();
    expect(activeBody.statusSummary.status).toBe("active");
    expect(activeBody.domain.isActive).toBe(true);
  });
});
