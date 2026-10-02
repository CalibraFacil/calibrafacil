import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  createResendDomain: vi.fn(),
  getResendDomain: vi.fn(),
  verifyResendDomain: vi.fn(),
  deleteResendDomain: vi.fn(),
}));
vi.mock("@calibra-facil/email-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/email-sender")>()),
  ...provider,
}));

import { emailDomainsRouter } from "./email-domains";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationEmailDomain,
} from "@calibra-facil/db/schema";
import {
  encryptResendApiKey,
  generateEmailDomainMasterKey,
  resolveLabEmailSender,
  getLabEmailCredential,
} from "@calibra-facil/email-sender";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import {
  saveManagedEmailDomain,
  removeEmailDomain,
} from "../lib/email-domain-lifecycle";

const RAW_KEY = "re_legacy_test_key_1234";
const PLATFORM_KEY = "re_platform_test_key_5678";
const MASTER_KEY = generateEmailDomainMasterKey();
const hostname = "certificados.lab.example.com";
const dnsRecords = [
  {
    type: "TXT",
    name: "resend._domainkey",
    value: "p=test",
    status: "not_started",
  },
];
const details = {
  id: "rd-managed",
  name: hostname,
  status: "not_started",
  records: dnsRecords,
};
const failure = {
  ok: false,
  errorName: "transport_error",
  message: "unavailable",
  failureClass: "transient",
};

function request(path: string, method = "GET", body?: unknown) {
  return emailDomainsRouter.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function createBody(host = hostname) {
  return { hostname: host, fromLocalPart: "os" };
}
async function setupOrg(orgId = "org-a", role = "admin") {
  const org = await seedOrg({ orgId, role });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  return org;
}
async function record(orgId = "org-a") {
  return db.query.organizationEmailDomain.findFirst({
    where: eq(organizationEmailDomain.organizationId, orgId),
  });
}

// Real database and RBAC; every provider operation is mocked and fetch is blocked.
describe("emailDomainsRouter — managed lifecycle and legacy reads", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("RESEND_API_KEY", PLATFORM_KEY);
    vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network request");
      }),
    );
    vi.resetAllMocks();
    provider.createResendDomain.mockResolvedValue({ ok: true, data: details });
    provider.getResendDomain.mockResolvedValue({
      ok: true,
      data: { ...details, status: "verified" },
    });
    provider.verifyResendDomain.mockResolvedValue({
      ok: true,
      data: { id: details.id },
    });
    provider.deleteResendDomain.mockResolvedValue({
      ok: true,
      data: { id: details.id },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("REQ-ED-001/003: isolates reads, collisions and provider deletion between tenants", async () => {
    const a = await setupOrg();
    expect((await request("/", "POST", createBody())).status).toBe(201);
    await setupOrg("org-b");
    expect((await (await request("/")).json()).domain).toBeNull();
    expect((await request("/", "POST", createBody())).status).toBe(409);
    expect((await request("/", "DELETE")).status).toBe(200);
    expect(provider.createResendDomain).toHaveBeenCalledTimes(1);
    expect(provider.deleteResendDomain).not.toHaveBeenCalled();
    expect(await record(a.orgId)).toBeDefined();
  });

  it("REQ-ED-002: denies member mutations before provider access", async () => {
    await setupOrg("org-member", "member");
    for (const [path, method] of [
      ["/", "POST"],
      ["/verify", "POST"],
      ["/activate", "POST"],
      ["/", "DELETE"],
    ]) {
      expect(
        (
          await request(
            path!,
            method!,
            method === "DELETE" ? undefined : createBody(),
          )
        ).status,
      ).toBe(403);
    }
    for (const mock of Object.values(provider))
      expect(mock).not.toHaveBeenCalled();
  });

  it("REQ-ED-004: rejects unauthenticated reads", async () => {
    logout();
    expect((await request("/")).status).toBe(401);
  });

  it("REQ-ED-005: creates with the platform key, null custody and verbatim DNS", async () => {
    await setupOrg();
    const res = await request("/", "POST", createBody());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.domain).toMatchObject({
      mode: "managed",
      hostname,
      fromAddress: `os@${hostname}`,
      apiKeyMasked: "",
      dnsRecords,
    });
    expect(JSON.stringify(body)).not.toContain(PLATFORM_KEY);
    expect(await record()).toMatchObject({
      resendApiKeyEncrypted: null,
      resendApiKeyIv: null,
      resendApiKeyLast4: null,
    });
    expect(provider.createResendDomain).toHaveBeenCalledWith(
      PLATFORM_KEY,
      hostname,
    );
    expect(body.statusSummary.status).toBe("waiting_verification");
  });

  it("verifies and activates managed senders without an encryption master key", async () => {
    const org = await setupOrg();
    await request("/", "POST", createBody());
    expect((await request("/activate", "POST")).status).toBe(400);
    expect((await request("/verify", "POST")).status).toBe(200);
    expect(provider.getResendDomain).toHaveBeenCalledWith(
      PLATFORM_KEY,
      details.id,
    );
    expect(provider.verifyResendDomain).toHaveBeenCalledWith(
      PLATFORM_KEY,
      details.id,
    );
    const res = await request("/activate", "POST");
    expect((await res.json()).statusSummary.status).toBe("active");
    expect(await resolveLabEmailSender(org.orgId)).toMatchObject({
      hostname,
      fromAddress: `os@${hostname}`,
    });
    expect(await getLabEmailCredential(org.orgId)).toMatchObject({
      apiKey: PLATFORM_KEY,
      hostname,
    });
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await resolveLabEmailSender(org.orgId)).toBeUndefined();
    expect(await getLabEmailCredential(org.orgId)).toBeUndefined();
  });

  it("reuses the owned domain on retries and local-part edits; requires removal before replacement", async () => {
    await setupOrg();
    await request("/", "POST", createBody());
    await request("/verify", "POST");
    await request("/activate", "POST");
    expect((await request("/", "POST", createBody())).status).toBe(200);
    expect((await record())?.isActive).toBe(true);
    expect(
      (
        await request("/", "POST", {
          ...createBody(),
          fromLocalPart: "contato",
        })
      ).status,
    ).toBe(200);
    expect(await record()).toMatchObject({
      resendDomainId: details.id,
      fromAddress: `contato@${hostname}`,
      isActive: false,
    });
    expect(
      (await request("/", "POST", createBody("other.example.com"))).status,
    ).toBe(409);
    expect(provider.createResendDomain).toHaveBeenCalledTimes(1);
    expect(provider.deleteResendDomain).not.toHaveBeenCalled();
  });

  it("serializes concurrent creation for the same organization", async () => {
    await setupOrg();
    const results = await Promise.all([
      request("/", "POST", createBody()),
      request("/", "POST", createBody()),
    ]);
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 201]);
    expect(provider.createResendDomain).toHaveBeenCalledTimes(1);
  });

  it("keeps the row on provider deletion failure, then permits removal and recreation", async () => {
    await setupOrg();
    await request("/", "POST", createBody());
    provider.deleteResendDomain.mockResolvedValueOnce(failure);
    expect((await request("/", "DELETE")).status).toBe(502);
    expect((await record())?.resendDomainId).toBe(details.id);
    expect((await request("/", "DELETE")).status).toBe(200);
    expect(provider.deleteResendDomain).toHaveBeenCalledWith(
      PLATFORM_KEY,
      details.id,
    );
    expect(await record()).toBeUndefined();
    expect((await request("/", "DELETE")).status).toBe(200);
    expect(provider.deleteResendDomain).toHaveBeenCalledTimes(2);
  });

  it("compensates a failed persistence write with deletion of only the newly created ID", async () => {
    const org = await setupOrg();
    await expect(
      saveManagedEmailDomain(
        {
          organizationId: org.orgId,
          userId: "nonexistent-user",
          memberId: org.memberId,
        },
        createBody(),
      ),
    ).rejects.toThrow();
    expect(provider.deleteResendDomain).toHaveBeenCalledWith(
      PLATFORM_KEY,
      details.id,
    );
    expect(await record()).toBeUndefined();
  });

  it("retains the provider ID if the deletion transaction fails so the request can retry", async () => {
    const org = await setupOrg();
    await request("/", "POST", createBody());
    await expect(
      removeEmailDomain({
        organizationId: org.orgId,
        userId: "nonexistent-user",
        memberId: org.memberId,
      }),
    ).rejects.toThrow();
    expect((await record())?.resendDomainId).toBe(details.id);
    expect((await request("/", "DELETE")).status).toBe(200);
    expect(await record()).toBeUndefined();
  });

  it("does not persist a failed provider create", async () => {
    await setupOrg();
    provider.createResendDomain.mockResolvedValueOnce(failure);
    expect((await request("/", "POST", createBody())).status).toBe(502);
    expect(await record()).toBeUndefined();
    expect(provider.deleteResendDomain).not.toHaveBeenCalled();
  });

  it("reads, verifies and sends legacy BYOK rows, and only unlinks them on deletion", async () => {
    const org = await setupOrg();
    const encrypted = encryptResendApiKey(RAW_KEY, MASTER_KEY);
    await db.insert(organizationEmailDomain).values({
      id: "legacy",
      organizationId: org.orgId,
      createdBy: org.userId,
      mode: "byok",
      hostname,
      resendDomainId: "rd-legacy",
      resendApiKeyEncrypted: encrypted.encrypted,
      resendApiKeyIv: encrypted.iv,
      resendApiKeyLast4: "1234",
      fromAddress: `os@${hostname}`,
      verifiedAt: new Date(),
      isActive: true,
    });
    expect(await resolveLabEmailSender(org.orgId)).toBeUndefined();
    vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", MASTER_KEY);
    expect(await resolveLabEmailSender(org.orgId)).toMatchObject({ hostname });
    expect(await getLabEmailCredential(org.orgId)).toMatchObject({
      apiKey: RAW_KEY,
    });
    const body = await (await request("/")).json();
    expect(body.domain.apiKeyMasked).toBe("••••1234");
    expect(JSON.stringify(body)).not.toContain(RAW_KEY);
    expect((await request("/verify", "POST")).status).toBe(200);
    expect(provider.getResendDomain).toHaveBeenCalledWith(RAW_KEY, "rd-legacy");
    expect((await request("/", "POST", createBody())).status).toBe(409);
    expect((await request("/", "DELETE")).status).toBe(200);
    expect(provider.deleteResendDomain).not.toHaveBeenCalled();
    expect(await record()).toBeUndefined();
  });

  it("exposes the organization contact email as the reply destination", async () => {
    const org = await setupOrg();
    expect((await (await request("/")).json()).replyToEmail).toBeNull();
    await db
      .update(organization)
      .set({ email: "contato@lab.example.com" })
      .where(eq(organization.id, org.orgId));
    expect((await (await request("/")).json()).replyToEmail).toBe(
      "contato@lab.example.com",
    );
  });

  it("no longer exposes BYOK creation or key-rotation endpoints", async () => {
    await setupOrg();
    expect(
      (await request("/validate-key", "POST", { apiKey: RAW_KEY })).status,
    ).toBe(404);
    expect((await request("/key", "POST", { apiKey: RAW_KEY })).status).toBe(
      404,
    );
    expect(
      (
        await request("/", "POST", {
          apiKey: RAW_KEY,
          resendDomainId: "rd-legacy",
          fromLocalPart: "os",
        })
      ).status,
    ).toBe(400);
    expect(provider.createResendDomain).not.toHaveBeenCalled();
  });
});
