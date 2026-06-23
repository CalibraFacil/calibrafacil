/**
 * authorized-signatories.int.spec.ts — Real-DB + real-RBAC integration tests for
 * the authorized-signatories router (ISO/IEC 17025:2017 §6.2.6 — personnel
 * authorized to sign/approve calibration certificates).
 *
 * ONLY the better-auth session is mocked (see test/integration/setup.ts).
 * requireLabAuth → requireOrganization → requireOrgType("LAB") → withLabPermission
 * (competence:read / competence:approve) all run for real against a seeded Postgres.
 *
 * Proven properties (oracle):
 *   REQ-SGTRY-001  [HIGH RISK] Tenant isolation (read): org-A admin GET / returns only
 *                  org-A's signatory (signatories.length === 1, id and userName match
 *                  org-A's seeded row; org-B's row is absent).
 *   REQ-SGTRY-002  [HIGH RISK] Tenant isolation (revoke): org-A admin POST /:id/revoke
 *                  using org-B's signatory id → 404; org-B's row stays ACTIVE (DB-verified).
 *   REQ-SGTRY-003  [HIGH RISK] RBAC grant: technician POST / → 403; admin POST / with a
 *                  valid grantee userId → 201 + exactly one row persisted (status ACTIVE,
 *                  authorizedBy = admin id, DB-verified) + "grant" audit row.
 *   REQ-SGTRY-004  [HIGH RISK] RBAC revoke: technician POST /:id/revoke → 403 + row stays
 *                  ACTIVE (DB-verified); admin POST /:id/revoke → 200, status "REVOKED",
 *                  revokedBy = admin id (DB-verified) + "revoke" audit row.
 *   REQ-SGTRY-005  Unauthenticated GET / and POST / → 401.
 *
 * ESCALATIONS: none — all oracle behaviours match stated spec.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { authorizedSignatoriesRouter } from "./authorized-signatories";
import { db } from "@calibra-facil/db";
import {
  authorizedSignatory,
  authorizedSignatoryAuditLog,
  user,
  member,
} from "@calibra-facil/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" } as const;

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT added to shared seed.ts
// ---------------------------------------------------------------------------

/**
 * Seed an authorized_signatory row directly, bypassing the POST / handler.
 * Used to set up preconditions for isolation and revoke tests.
 */
async function seedSignatory(params: {
  organizationId: string;
  userId: string;
  authorizedBy: string;
  status?: "ACTIVE" | "REVOKED";
  assetTypeId?: number | null;
}): Promise<number> {
  const [row] = await db
    .insert(authorizedSignatory)
    .values({
      organizationId: params.organizationId,
      userId: params.userId,
      authorizedBy: params.authorizedBy,
      assetTypeId: params.assetTypeId ?? null,
      status: params.status ?? "ACTIVE",
    })
    .returning({ id: authorizedSignatory.id });
  if (!row) throw new Error("seedSignatory: insert failed");
  return row.id;
}

/**
 * Insert an extra user + member into an existing org.
 * Mirrors the pattern in methods.int.spec.ts.
 */
async function seedExtraMember(params: {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "technician" | "operator" | "member";
}): Promise<void> {
  await db.insert(user).values({
    id: params.userId,
    name: `User ${params.userId}`,
    email: `${params.userId}@lab.test`,
  });
  await db.insert(member).values({
    id: `member-${params.userId}`,
    organizationId: params.orgId,
    userId: params.userId,
    role: params.role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authorizedSignatoriesRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // REQ-SGTRY-001 — Tenant isolation (read)
  // -------------------------------------------------------------------------
  it(
    "REQ-SGTRY-001 GET / returns only the authenticated org's signatories (tenant isolation)",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      // Seed one signatory per org
      const signatoryAId = await seedSignatory({
        organizationId: orgA.orgId,
        userId: orgA.userId,
        authorizedBy: orgA.userId,
      });
      await seedSignatory({
        organizationId: orgB.orgId,
        userId: orgB.userId,
        authorizedBy: orgB.userId,
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await authorizedSignatoriesRouter.request("/", {
        headers: JSON_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Exactly one signatory — org B's row must be absent
      expect(body.signatories).toHaveLength(1);

      const returned: { id: number; userId: string; userName: string } =
        body.signatories[0];
      expect(returned.id).toBe(signatoryAId);
      expect(returned.userId).toBe(orgA.userId);
      // userName is joined from the user table — must be org A's user name
      expect(returned.userName).toBe(`User ${orgA.userId}`);
    },
  );

  // -------------------------------------------------------------------------
  // REQ-SGTRY-002 — Tenant isolation (revoke)
  // -------------------------------------------------------------------------
  it(
    "REQ-SGTRY-002 POST /:id/revoke on another org's signatory → 404, row stays ACTIVE",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      // Seed an ACTIVE signatory in org B
      const orgBSignatoryId = await seedSignatory({
        organizationId: orgB.orgId,
        userId: orgB.userId,
        authorizedBy: orgB.userId,
      });

      // Log in as org A admin and attempt to revoke org B's signatory
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
      const res = await authorizedSignatoriesRouter.request(
        `/${orgBSignatoryId}/revoke`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason: "Cross-tenant revoke attempt" }),
        },
      );

      // Must be 404 (scoped lookup: id AND organizationId → not found for org A)
      expect(res.status).toBe(404);

      // DB-verify: org B's row is still ACTIVE
      const [row] = await db
        .select({ status: authorizedSignatory.status })
        .from(authorizedSignatory)
        .where(eq(authorizedSignatory.id, orgBSignatoryId));
      expect(row?.status).toBe("ACTIVE");
    },
  );

  // -------------------------------------------------------------------------
  // REQ-SGTRY-003 — RBAC grant
  // -------------------------------------------------------------------------
  it(
    "REQ-SGTRY-003 POST / as technician → 403; as admin → 201 with correct DB state + audit row",
    async () => {
      // --- Part A: technician is blocked ---
      const techOrg = await seedOrg({ orgId: "org-tech", role: "technician" });
      loginAs({ userId: techOrg.userId, organizationId: techOrg.orgId });

      const techRes = await authorizedSignatoriesRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ userId: techOrg.userId }),
      });
      expect(techRes.status).toBe(403);

      await truncateAll();

      // --- Part B: admin succeeds ---
      const adminOrg = await seedOrg({
        orgId: "org-admin",
        userId: "admin-user",
        role: "admin",
      });

      // Seed a second member to act as the grantee
      await seedExtraMember({
        userId: "grantee-user",
        orgId: adminOrg.orgId,
        role: "technician",
      });

      loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });
      const adminRes = await authorizedSignatoriesRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          userId: "grantee-user",
          assetTypeId: null,
        }),
      });

      expect(adminRes.status).toBe(201);
      const body = await adminRes.json();
      const created: {
        id: number;
        organizationId: string;
        userId: string;
        status: string;
        authorizedBy: string;
      } = body.signatory;
      expect(created.organizationId).toBe(adminOrg.orgId);
      expect(created.userId).toBe("grantee-user");
      expect(created.status).toBe("ACTIVE");
      expect(created.authorizedBy).toBe(adminOrg.userId);

      // DB-verify: exactly one signatory row with the expected fields
      const rows = await db
        .select()
        .from(authorizedSignatory)
        .where(
          and(
            eq(authorizedSignatory.organizationId, adminOrg.orgId),
            isNull(authorizedSignatory.deletedAt),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("ACTIVE");
      expect(rows[0]?.authorizedBy).toBe(adminOrg.userId);
      expect(rows[0]?.userId).toBe("grantee-user");

      // DB-verify: "grant" audit row exists for the created signatory
      const auditRows = await db
        .select()
        .from(authorizedSignatoryAuditLog)
        .where(
          and(
            eq(authorizedSignatoryAuditLog.signatoryId, created.id),
            eq(authorizedSignatoryAuditLog.action, "grant"),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.performedBy).toBe(adminOrg.userId);
    },
  );

  // -------------------------------------------------------------------------
  // REQ-SGTRY-004 — RBAC revoke
  // -------------------------------------------------------------------------
  it(
    "REQ-SGTRY-004 POST /:id/revoke as technician → 403 (row stays ACTIVE); as admin → 200 + REVOKED + audit row",
    async () => {
      // --- Part A: technician is blocked ---
      const techOrg = await seedOrg({
        orgId: "org-t",
        userId: "tech-user",
        role: "technician",
      });

      const techSignatoryId = await seedSignatory({
        organizationId: techOrg.orgId,
        userId: techOrg.userId,
        authorizedBy: techOrg.userId,
      });

      loginAs({ userId: techOrg.userId, organizationId: techOrg.orgId });
      const techRes = await authorizedSignatoriesRouter.request(
        `/${techSignatoryId}/revoke`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason: "Blocked attempt" }),
        },
      );
      expect(techRes.status).toBe(403);

      // DB-verify: row still ACTIVE after blocked revoke
      const [techRow] = await db
        .select({ status: authorizedSignatory.status })
        .from(authorizedSignatory)
        .where(eq(authorizedSignatory.id, techSignatoryId));
      expect(techRow?.status).toBe("ACTIVE");

      await truncateAll();

      // --- Part B: admin succeeds ---
      const adminOrg = await seedOrg({
        orgId: "org-a",
        userId: "admin-u",
        role: "admin",
      });

      // Seed a grantee and an ACTIVE signatory
      await seedExtraMember({
        userId: "grantee-u",
        orgId: adminOrg.orgId,
        role: "technician",
      });

      const signatoryId = await seedSignatory({
        organizationId: adminOrg.orgId,
        userId: "grantee-u",
        authorizedBy: adminOrg.userId,
      });

      loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });
      const adminRes = await authorizedSignatoriesRouter.request(
        `/${signatoryId}/revoke`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason: "Technician left the lab" }),
        },
      );

      expect(adminRes.status).toBe(200);
      const body = await adminRes.json();
      const updated: { id: number; status: string; revokedBy: string } =
        body.signatory;
      expect(updated.status).toBe("REVOKED");
      expect(updated.revokedBy).toBe(adminOrg.userId);

      // DB-verify: status REVOKED + revokedBy set
      const [dbRow] = await db
        .select({
          status: authorizedSignatory.status,
          revokedBy: authorizedSignatory.revokedBy,
          revokedAt: authorizedSignatory.revokedAt,
        })
        .from(authorizedSignatory)
        .where(eq(authorizedSignatory.id, signatoryId));
      expect(dbRow?.status).toBe("REVOKED");
      expect(dbRow?.revokedBy).toBe(adminOrg.userId);
      expect(dbRow?.revokedAt).not.toBeNull();

      // DB-verify: "revoke" audit row exists
      const auditRows = await db
        .select()
        .from(authorizedSignatoryAuditLog)
        .where(
          and(
            eq(authorizedSignatoryAuditLog.signatoryId, signatoryId),
            eq(authorizedSignatoryAuditLog.action, "revoke"),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.performedBy).toBe(adminOrg.userId);
    },
  );

  // -------------------------------------------------------------------------
  // REQ-SGTRY-005 — Unauthenticated requests → 401
  // -------------------------------------------------------------------------
  it("REQ-SGTRY-005 unauthenticated GET / and POST / → 401", async () => {
    logout();

    const getRes = await authorizedSignatoriesRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(401);

    const postRes = await authorizedSignatoriesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ userId: "someone" }),
    });
    expect(postRes.status).toBe(401);
  });
});
