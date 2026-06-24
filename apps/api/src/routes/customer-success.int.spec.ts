import { beforeEach, describe, expect, it } from "vitest";
import { customerSuccessRouter } from "./customer-success";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationSupportRequest,
  member as memberTable,
  user as userTable,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the customer-success router.
// Only the better-auth lab session is mocked (see test/integration/setup.ts);
// the REAL guard chain runs against a seeded Postgres:
//
//   customerSuccessRouter.use("*", ...requireLabProtected, requireOrgType("LAB"))
//     = requireLabAuth -> requireOrganization -> requireOrgType("LAB")   (L124)
//
// There is NO requirePermission/requireRole gate on this router — it is a
// SCOPE-ONLY surface (like notifications). Tenant isolation is therefore enforced
// purely by the `organizationId` WHERE clause, and the lab-only gate is enforced
// by requireOrgType("LAB"). Both are bound to the REAL columns below.
//
// Scoping contract (quoted from customer-success.ts):
//   GET /requests  -> listSupportRequests(member.organizationId, true)        (L244)
//   listSupportRequests filters:
//     where: eq(organizationSupportRequest.organizationId, organizationId)    (L69)
//   POST /requests -> insert .values({ organizationId: member.organizationId, // L267
//                                      requestedByUserId: session.user.id, ... })
//   The CreateSupportRequestSchema has NO organizationId field — a client cannot
//   redirect the write to another tenant; org comes from the session member.

const JSON_HEADERS = { "content-type": "application/json" } as const;

/**
 * Seed a support-request row scoped to an org. Inline (not added to shared seed.ts).
 * organizationId is the SOLE isolation discriminator — every other column is shared
 * across the seeded orgs so the test cannot pass by accident on some other column.
 */
async function seedSupportRequest(params: {
  organizationId: string;
  requestedByUserId: string;
  subject: string;
  category?: "GENERAL" | "TRAINING" | "MIGRATION";
  status?: "OPEN" | "RESOLVED";
}): Promise<number> {
  const [row] = await db
    .insert(organizationSupportRequest)
    .values({
      organizationId: params.organizationId,
      requestedByUserId: params.requestedByUserId,
      category: params.category ?? "GENERAL",
      priority: "NORMAL",
      status: params.status ?? "OPEN",
      subject: params.subject,
      description: "Descrição compartilhada entre os tenants do teste",
    })
    .returning({ id: organizationSupportRequest.id });
  if (!row) throw new Error("seedSupportRequest: insert failed");
  return row.id;
}

/**
 * Seed a CLIENT organization with a member, to exercise requireOrgType("LAB").
 * seedOrg() always creates a LAB org, so the lab-only gate is seeded inline.
 */
async function seedClientOrgMember(params: {
  orgId: string;
  userId: string;
}): Promise<{ orgId: string; userId: string }> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(userTable).values({
    id: params.userId,
    name: `User ${params.userId}`,
    email: `${params.userId}@client.test`,
  });
  await db.insert(organization).values({
    id: params.orgId,
    name: `Client ${params.orgId}`,
    slug: params.orgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: now,
  });
  await db.insert(memberTable).values({
    id: `member-${params.orgId}-${params.userId}`,
    organizationId: params.orgId,
    userId: params.userId,
    role: "owner",
    createdAt: now,
  });
  return { orgId: params.orgId, userId: params.userId };
}

describe("customerSuccessRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-CS-001 [HIGH RISK] — tenant READ isolation
  // org-A sees only org-A's support requests; org-B's leak row is absent.
  // Sole-discriminator construction: both rows share category/priority/status/
  // description; ONLY organizationId differs. The filter under test is
  //   eq(organizationSupportRequest.organizationId, organizationId)  (L69)
  // ===========================================================================
  it("REQ-CS-001: GET /requests returns only the authed org's requests (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "member" });
    const orgB = await seedOrg({ orgId: "org-b", role: "member" });

    await seedSupportRequest({
      organizationId: orgA.orgId,
      requestedByUserId: orgA.userId,
      subject: "ORG A REQUEST",
    });
    await seedSupportRequest({
      organizationId: orgB.orgId,
      requestedByUserId: orgB.userId,
      subject: "ORG B LEAK",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await customerSuccessRouter.request("/requests", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const subjects: string[] = body.data.map(
      (request: { subject: string }) => request.subject,
    );
    expect(subjects).toContain("ORG A REQUEST");
    expect(subjects).not.toContain("ORG B LEAK");
    expect(body.data).toHaveLength(1);
    // No org-B id may appear anywhere in the serialized response.
    expect(JSON.stringify(body)).not.toContain("ORG B LEAK");
    for (const request of body.data) {
      if ("organizationId" in request) {
        expect(request.organizationId).toBe(orgA.orgId);
      }
    }
  });

  // ===========================================================================
  // REQ-CS-002 [HIGH RISK] — WRITE scoping
  // A POST /requests by an org-A member is persisted to org-A ONLY. The payload
  // schema (CreateSupportRequestSchema) has no organizationId, so the write is
  // bound to member.organizationId (L267). org-B must observe nothing.
  // Plus the lab-only gate: a CLIENT-org member is rejected by requireOrgType.
  // ===========================================================================
  it("REQ-CS-002: POST /requests persists scoped to the authed org; org-B sees nothing", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "member" });
    const orgB = await seedOrg({ orgId: "org-b", role: "member" });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await customerSuccessRouter.request("/requests", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        category: "GENERAL",
        subject: "Solicitação criada pelo org A",
        description: "Conteúdo da solicitação do laboratório A",
        priority: "NORMAL",
      }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.organizationId).toBe(orgA.orgId);
    expect(created.requestedByUserId).toBe(orgA.userId);

    // The row physically landed in org-A, never org-B.
    const persisted = await db
      .select({
        organizationId: organizationSupportRequest.organizationId,
        subject: organizationSupportRequest.subject,
      })
      .from(organizationSupportRequest)
      .where(eq(organizationSupportRequest.id, created.id));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.organizationId).toBe(orgA.orgId);

    // org-B's own scoped read sees zero requests.
    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    const resB = await customerSuccessRouter.request("/requests", {
      headers: JSON_HEADERS,
    });
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB.data).toHaveLength(0);
  });

  it("REQ-CS-002: POST /requests by a CLIENT-org member -> 403 (requireOrgType LAB)", async () => {
    const client = await seedClientOrgMember({
      orgId: "client-org",
      userId: "client-user",
    });

    loginAs({ userId: client.userId, organizationId: client.orgId });
    const res = await customerSuccessRouter.request("/requests", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        category: "GENERAL",
        subject: "Tentativa de um org CLIENT",
        description: "Não deveria ser aceita por um org CLIENT",
        priority: "NORMAL",
      }),
    });

    expect(res.status).toBe(403);

    // Nothing was written.
    const rows = await db
      .select({ id: organizationSupportRequest.id })
      .from(organizationSupportRequest);
    expect(rows).toHaveLength(0);
  });

  // ===========================================================================
  // REQ-CS-003 — unauthenticated -> 401 (requireLabAuth)
  // ===========================================================================
  it("REQ-CS-003: GET /requests unauthenticated -> 401", async () => {
    logout();
    const res = await customerSuccessRouter.request("/requests", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  it("REQ-CS-003: GET /profile unauthenticated -> 401", async () => {
    logout();
    const res = await customerSuccessRouter.request("/profile", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // happy-path — POST then GET round-trip persists + returns org-scoped data.
  // ===========================================================================
  it("happy-path: POST /requests then GET /requests round-trips the org-scoped request", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const postRes = await customerSuccessRouter.request("/requests", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        category: "TRAINING",
        subject: "Preciso de treinamento na plataforma",
        description: "Gostaria de uma sessão de treinamento para a equipe",
        priority: "HIGH",
      }),
    });
    expect(postRes.status).toBe(201);
    const created = await postRes.json();

    const getRes = await customerSuccessRouter.request("/requests", {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.data).toHaveLength(1);
    const fetched = body.data[0];
    expect(fetched.id).toBe(created.id);
    expect(fetched.subject).toBe("Preciso de treinamento na plataforma");
    expect(fetched.category).toBe("TRAINING");
    expect(fetched.priority).toBe("HIGH");
    expect(fetched.status).toBe("OPEN");
    // The "created" lifecycle event is public-visible and round-trips too.
    const kinds: string[] = fetched.events.map(
      (event: { kind: string }) => event.kind,
    );
    expect(kinds).toContain("created");
  });

  // ===========================================================================
  // happy-path (read): GET /support-policy returns the org's plan policy.
  // FREE plan (no subscription row) -> 48h first-response target.
  // ===========================================================================
  it("happy-path: GET /support-policy returns the authed org's plan support policy", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const res = await customerSuccessRouter.request("/support-policy", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.planId).toBe("FREE");
    expect(body.supportPolicy.targetFirstResponseBusinessHours).toBe(48);
  });
});
