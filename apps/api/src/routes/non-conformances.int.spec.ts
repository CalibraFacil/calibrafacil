/**
 * non-conformances.int.spec.ts — Real-DB + real-RBAC integration tests for the
 * ISO 17025 §8.7 Non-Conformance workflow.
 *
 * ONLY the better-auth session and notifications side-effects are mocked (see
 * test/integration/setup.ts for the session mock).  requireLabAuth →
 * requireOrganization → withLabPermission all run for real against the seeded
 * Postgres.
 *
 * Proven properties (oracle):
 *   REQ-NC-001  [HIGH RISK] Tenant isolation: org A cannot act on org B's NC
 *   REQ-NC-002  [HIGH RISK] State machine: open → under_review → resolved; guards
 *   REQ-NC-003  [HIGH RISK] Disposition approval RBAC: use_as_is technician→403, admin→200
 *   REQ-NC-004  RBAC: member/operator cannot create/update/escalate; technician cannot escalate
 *   REQ-NC-005  [HIGH RISK] Escalate: creates linked CAPA; duplicate escalate → 400
 *   REQ-NC-006  Unauthenticated requests → 401
 *
 * IDENTITY-SEPARATION NOTE (not asserted as correct behavior):
 *   The route enforces role-based RBAC only; NO identity-based four-eyes (unlike
 *   jobs.ts).  The detector can disposition+resolve their own NC.  ISO §8.7/§6.5
 *   impartiality consideration — flagged for human review in ESCALATIONS section.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nonConformancesRouter } from "./non-conformances";
import { db } from "@calibra-facil/db";
import {
  nonConformance,
  correctiveAction,
  user,
  member,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// Notification side-effects: no-op in workflow correctness tests
// ---------------------------------------------------------------------------

vi.mock("@calibra-facil/notifications", () => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCEscalatedToCapa: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

/** Deterministic date far in the past so ageDays is stable-positive. */
const DETECTED_AT = "2026-01-15T10:00:00.000Z";

/**
 * Insert a non_conformance row directly so any status/disposition can be set,
 * bypassing the POST / handler's initial-status lock.
 */
async function seedNC(params: {
  orgId: string;
  detectedByUserId: string;
  status?: "open" | "under_review" | "resolved";
  disposition?: "rework" | "scrap" | "use_as_is" | "concession" | null;
  ncNumberSuffix?: string;
}): Promise<number> {
  const year = 2026;
  const suffix = params.ncNumberSuffix ?? Math.random().toString(36).slice(2, 7);
  const ncNumber = `NC-${year}-${suffix}`;

  const [row] = await db
    .insert(nonConformance)
    .values({
      ncNumber,
      organizationId: params.orgId,
      type: "work",
      description: "Medicao fora de tolerancia no ensaio de balanca",
      detectedBy: params.detectedByUserId,
      detectedAt: new Date(DETECTED_AT),
      status: params.status ?? "open",
      disposition: params.disposition ?? null,
      createdBy: params.detectedByUserId,
    })
    .returning({ id: nonConformance.id });

  if (!row) throw new Error("seedNC: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("nonConformancesRouter — ISO 17025 §8.7 NC workflow", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-NC-001 [HIGH RISK] Tenant isolation
  // =========================================================================
  it(
    "REQ-NC-001: org A cannot disposition / resolve / GET org B's NC; GET / returns only org A NCs with exact count",
    async () => {
      // Seed two independent orgs
      const orgA = await seedOrg({ orgId: "org-a", userId: "user-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", userId: "user-b", role: "admin" });

      // Seed 2 NCs for org A, 1 for org B
      await seedNC({ orgId: "org-a", detectedByUserId: "user-a", ncNumberSuffix: "A001" });
      await seedNC({ orgId: "org-a", detectedByUserId: "user-a", ncNumberSuffix: "A002" });
      const ncBId = await seedNC({ orgId: "org-b", detectedByUserId: "user-b", ncNumberSuffix: "B001" });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      // GET / — should return exactly 2 (org A only)
      const listRes = await nonConformancesRouter.request("/", {
        headers: JSON_HEADERS,
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.pagination.total).toBe(2);
      const numbers = listBody.data.map(
        (nc: { ncNumber: string }) => nc.ncNumber,
      );
      expect(numbers).toContain("NC-2026-A001");
      expect(numbers).toContain("NC-2026-A002");
      expect(numbers).not.toContain("NC-2026-B001");

      // GET /:id cross-tenant → 404
      const getRes = await nonConformancesRouter.request(`/${ncBId}`, {
        headers: JSON_HEADERS,
      });
      expect(getRes.status).toBe(404);

      // PUT /:id/disposition cross-tenant → 404
      const dispositionRes = await nonConformancesRouter.request(
        `/${ncBId}/disposition`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ disposition: "rework" }),
        },
      );
      expect(dispositionRes.status).toBe(404);

      // POST /:id/resolve cross-tenant → 404
      // (org B's NC is "open" with no disposition, but org A can't even see it)
      const resolveRes = await nonConformancesRouter.request(
        `/${ncBId}/resolve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ correctionTaken: "Correcao realizada com sucesso" }),
        },
      );
      expect(resolveRes.status).toBe(404);

      // DB: org B's NC is completely unchanged
      const [row] = await db
        .select({ status: nonConformance.status, disposition: nonConformance.disposition })
        .from(nonConformance)
        .where(eq(nonConformance.id, ncBId));
      expect(row?.status).toBe("open");
      expect(row?.disposition).toBeNull();

      void orgB;
    },
  );

  // =========================================================================
  // REQ-NC-002 [HIGH RISK] State machine
  // =========================================================================
  it(
    "REQ-NC-002: state machine — rework disposition on open NC → under_review; resolve without disposition → 400; resolve with disposition → resolved; re-resolve → 400; disposition resolved NC → 400",
    async () => {
      await seedOrg({ orgId: "org-a", userId: "user-a", role: "technician" });
      loginAs({ userId: "user-a", organizationId: "org-a" });

      // -----------------------------------------------------------------------
      // 2a: disposition "rework" on an "open" NC → 200 + under_review
      // -----------------------------------------------------------------------
      const openNcId = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-a",
        status: "open",
        ncNumberSuffix: "SM001",
      });

      const dispositionRes = await nonConformancesRouter.request(
        `/${openNcId}/disposition`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ disposition: "rework" }),
        },
      );
      expect(dispositionRes.status).toBe(200);
      const dispositionBody = await dispositionRes.json();
      expect(dispositionBody.status).toBe("under_review");
      expect(dispositionBody.disposition).toBe("rework");

      // DB-verify
      const [reviewRow] = await db
        .select({ status: nonConformance.status, disposition: nonConformance.disposition })
        .from(nonConformance)
        .where(eq(nonConformance.id, openNcId));
      expect(reviewRow?.status).toBe("under_review");
      expect(reviewRow?.disposition).toBe("rework");

      // -----------------------------------------------------------------------
      // 2b: resolve an NC with disposition=null → 400
      // -----------------------------------------------------------------------
      const nullDispositionNcId = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-a",
        status: "open",
        disposition: null,
        ncNumberSuffix: "SM002",
      });

      const resolveNullRes = await nonConformancesRouter.request(
        `/${nullDispositionNcId}/resolve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ correctionTaken: "Retrabalhado e inspecionado" }),
        },
      );
      expect(resolveNullRes.status).toBe(400);
      const resolveNullBody = await resolveNullRes.json();
      // Route says: "Defina a disposicao antes de resolver a nao conformidade"
      expect(resolveNullBody.error).toMatch(/disposicao/i);

      // DB: still open / no change
      const [nullDispRow] = await db
        .select({ status: nonConformance.status })
        .from(nonConformance)
        .where(eq(nonConformance.id, nullDispositionNcId));
      expect(nullDispRow?.status).toBe("open");

      // -----------------------------------------------------------------------
      // 2c: resolve an NC that already has a disposition → 200 + resolved
      // -----------------------------------------------------------------------
      const withDispositionNcId = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-a",
        status: "under_review",
        disposition: "scrap",
        ncNumberSuffix: "SM003",
      });

      const resolveRes = await nonConformancesRouter.request(
        `/${withDispositionNcId}/resolve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ correctionTaken: "Item descartado conforme procedimento" }),
        },
      );
      expect(resolveRes.status).toBe(200);
      const resolveBody = await resolveRes.json();
      expect(resolveBody.data.status).toBe("resolved");

      // DB-verify
      const [resolvedRow] = await db
        .select({ status: nonConformance.status })
        .from(nonConformance)
        .where(eq(nonConformance.id, withDispositionNcId));
      expect(resolvedRow?.status).toBe("resolved");

      // -----------------------------------------------------------------------
      // 2d: resolve an already-resolved NC → 400
      // -----------------------------------------------------------------------
      const resolvedNcId = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-a",
        status: "resolved",
        disposition: "rework",
        ncNumberSuffix: "SM004",
      });

      const reResolveRes = await nonConformancesRouter.request(
        `/${resolvedNcId}/resolve`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ correctionTaken: "Tentativa de re-resolucao" }),
        },
      );
      expect(reResolveRes.status).toBe(400);

      // DB: still resolved
      const [reResolvedRow] = await db
        .select({ status: nonConformance.status })
        .from(nonConformance)
        .where(eq(nonConformance.id, resolvedNcId));
      expect(reResolvedRow?.status).toBe("resolved");

      // -----------------------------------------------------------------------
      // 2e: disposition a resolved NC → 400
      // -----------------------------------------------------------------------
      const resolvedNcId2 = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-a",
        status: "resolved",
        disposition: "scrap",
        ncNumberSuffix: "SM005",
      });

      const dispResolvedRes = await nonConformancesRouter.request(
        `/${resolvedNcId2}/disposition`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ disposition: "rework" }),
        },
      );
      expect(dispResolvedRes.status).toBe(400);

      // DB: disposition unchanged (still "scrap")
      const [resolvedDispRow] = await db
        .select({ disposition: nonConformance.disposition })
        .from(nonConformance)
        .where(eq(nonConformance.id, resolvedNcId2));
      expect(resolvedDispRow?.disposition).toBe("scrap");
    },
  );

  // =========================================================================
  // REQ-NC-003 [HIGH RISK] Disposition approval RBAC
  // =========================================================================
  it(
    "REQ-NC-003: use_as_is as technician → 403; use_as_is as admin with justification ≥10 → 200 + dispositionApprovedBy set; rework as technician → 200",
    async () => {
      // Seed org with admin user
      const orgAdmin = await seedOrg({ orgId: "org-a", userId: "user-admin", role: "admin" });

      // Seed an additional technician user in the same org
      const techUserId = "user-tech";
      await db.insert(user).values({
        id: techUserId,
        name: "Tecnico Test",
        email: `${techUserId}@lab.test`,
      });
      await db.insert(member).values({
        id: `member-${techUserId}`,
        organizationId: "org-a",
        userId: techUserId,
        role: "technician",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      // -----------------------------------------------------------------------
      // 3a: technician tries use_as_is → 403
      // -----------------------------------------------------------------------
      const ncForTech = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-admin",
        status: "open",
        ncNumberSuffix: "RBAC001",
      });

      loginAs({ userId: techUserId, organizationId: "org-a" });
      const techUseAsIsRes = await nonConformancesRouter.request(
        `/${ncForTech}/disposition`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            disposition: "use_as_is",
            justification: "Justificativa suficiente para uso",
          }),
        },
      );
      expect(techUseAsIsRes.status).toBe(403);

      // DB: NC unchanged (still open, no disposition)
      const [techNcRow] = await db
        .select({ status: nonConformance.status, disposition: nonConformance.disposition })
        .from(nonConformance)
        .where(eq(nonConformance.id, ncForTech));
      expect(techNcRow?.status).toBe("open");
      expect(techNcRow?.disposition).toBeNull();

      // -----------------------------------------------------------------------
      // 3b: admin uses use_as_is with justification ≥10 chars → 200 + dispositionApprovedBy set
      // -----------------------------------------------------------------------
      const ncForAdmin = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-admin",
        status: "open",
        ncNumberSuffix: "RBAC002",
      });

      loginAs({ userId: orgAdmin.userId, organizationId: "org-a" });
      const adminUseAsIsRes = await nonConformancesRouter.request(
        `/${ncForAdmin}/disposition`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            disposition: "use_as_is",
            justification: "Aprovado pelo gerente tecnico apos analise",
          }),
        },
      );
      expect(adminUseAsIsRes.status).toBe(200);
      const adminBody = await adminUseAsIsRes.json();
      expect(adminBody.status).toBe("under_review");
      expect(adminBody.dispositionApprovedBy).toBe(orgAdmin.userId);

      // DB-verify dispositionApprovedBy is set
      const [adminNcRow] = await db
        .select({
          status: nonConformance.status,
          disposition: nonConformance.disposition,
          dispositionApprovedBy: nonConformance.dispositionApprovedBy,
        })
        .from(nonConformance)
        .where(eq(nonConformance.id, ncForAdmin));
      expect(adminNcRow?.status).toBe("under_review");
      expect(adminNcRow?.disposition).toBe("use_as_is");
      expect(adminNcRow?.dispositionApprovedBy).toBe(orgAdmin.userId);

      // -----------------------------------------------------------------------
      // 3c: technician sets disposition "rework" → 200 (allowed for any update-role)
      // -----------------------------------------------------------------------
      const ncForRework = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-admin",
        status: "open",
        ncNumberSuffix: "RBAC003",
      });

      loginAs({ userId: techUserId, organizationId: "org-a" });
      const reworkRes = await nonConformancesRouter.request(
        `/${ncForRework}/disposition`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ disposition: "rework" }),
        },
      );
      expect(reworkRes.status).toBe(200);
      const reworkBody = await reworkRes.json();
      expect(reworkBody.status).toBe("under_review");
      expect(reworkBody.disposition).toBe("rework");
    },
  );

  // =========================================================================
  // REQ-NC-004 RBAC — member and operator cannot create/update/escalate
  // =========================================================================
  it(
    "REQ-NC-004: member → 403 on create/disposition/resolve; operator → 403 on create/disposition/resolve; technician → 403 on escalate-to-capa",
    async () => {
      // Admin seeds org objects
      await seedOrg({ orgId: "org-a", userId: "user-admin", role: "admin" });

      // Seed restricted-role users
      const restrictedUsers = [
        { userId: "user-member", role: "member" },
        { userId: "user-operator", role: "operator" },
      ] as const;

      for (const { userId, role } of restrictedUsers) {
        await db.insert(user).values({
          id: userId,
          name: `User ${userId}`,
          email: `${userId}@lab.test`,
        });
        await db.insert(member).values({
          id: `member-${userId}`,
          organizationId: "org-a",
          userId,
          role,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });
      }

      // Seed an NC as admin for disposition/resolve tests
      const ncId = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-admin",
        status: "open",
        ncNumberSuffix: "RBAC004",
      });

      // Test create and disposition/resolve for member and operator
      for (const { userId } of restrictedUsers) {
        loginAs({ userId, organizationId: "org-a" });

        // POST / (create) → 403
        const createRes = await nonConformancesRouter.request("/", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            type: "work",
            description: "Tentativa de criar NC sem permissao",
            detectedAt: DETECTED_AT,
          }),
        });
        expect(createRes.status, `POST / as ${userId}`).toBe(403);

        // PUT /:id/disposition → 403
        const dispositionRes = await nonConformancesRouter.request(
          `/${ncId}/disposition`,
          {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify({ disposition: "rework" }),
          },
        );
        expect(dispositionRes.status, `PUT /${ncId}/disposition as ${userId}`).toBe(403);

        // POST /:id/resolve → 403
        const resolveRes = await nonConformancesRouter.request(
          `/${ncId}/resolve`,
          {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ correctionTaken: "Correcao de teste tentativa" }),
          },
        );
        expect(resolveRes.status, `POST /${ncId}/resolve as ${userId}`).toBe(403);
      }

      // Seed technician user
      const techUserId = "user-tech-esc";
      await db.insert(user).values({
        id: techUserId,
        name: "Tecnico Escalation",
        email: `${techUserId}@lab.test`,
      });
      await db.insert(member).values({
        id: `member-${techUserId}`,
        organizationId: "org-a",
        userId: techUserId,
        role: "technician",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      // POST /:id/escalate-to-capa as technician → 403 (no escalate permission)
      loginAs({ userId: techUserId, organizationId: "org-a" });
      const escalateRes = await nonConformancesRouter.request(
        `/${ncId}/escalate-to-capa`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(escalateRes.status).toBe(403);

      // DB: NC is still open and untouched
      const [row] = await db
        .select({ status: nonConformance.status, disposition: nonConformance.disposition })
        .from(nonConformance)
        .where(eq(nonConformance.id, ncId));
      expect(row?.status).toBe("open");
      expect(row?.disposition).toBeNull();
    },
  );

  // =========================================================================
  // REQ-NC-005 [HIGH RISK] Escalate to CAPA
  // =========================================================================
  it(
    "REQ-NC-005: admin escalates NC with no capaId → 201 + capaId set (DB-verified); re-escalate same NC → 400",
    async () => {
      const org = await seedOrg({ orgId: "org-a", userId: "user-admin", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const ncId = await seedNC({
        orgId: "org-a",
        detectedByUserId: "user-admin",
        status: "open",
        ncNumberSuffix: "ESC001",
      });

      // First escalation → 201 + CAPA created
      const escalateRes = await nonConformancesRouter.request(
        `/${ncId}/escalate-to-capa`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            rootCauseAnalysis: "Falha no procedimento de verificacao",
            actionPlan: "Revisar e atualizar procedimento operacional",
          }),
        },
      );
      expect(escalateRes.status).toBe(201);
      const escalateBody = await escalateRes.json();
      expect(escalateBody.data.capa).toBeDefined();
      expect(typeof escalateBody.data.capa.id).toBe("number");
      expect(escalateBody.data.nc.capaId).toBe(escalateBody.data.capa.id);

      const capaId: number = escalateBody.data.capa.id;

      // DB-verify NC.capaId is set
      const [ncRow] = await db
        .select({ capaId: nonConformance.capaId })
        .from(nonConformance)
        .where(eq(nonConformance.id, ncId));
      expect(ncRow?.capaId).toBe(capaId);

      // DB-verify CAPA row exists and is scoped to the same org
      const [capaRow] = await db
        .select({ id: correctiveAction.id, organizationId: correctiveAction.organizationId })
        .from(correctiveAction)
        .where(
          and(
            eq(correctiveAction.id, capaId),
            eq(correctiveAction.organizationId, "org-a"),
          ),
        );
      expect(capaRow).toBeDefined();
      expect(capaRow?.id).toBe(capaId);

      // Second escalation on the same NC → 400 (already has CAPA)
      const reEscalateRes = await nonConformancesRouter.request(
        `/${ncId}/escalate-to-capa`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
      expect(reEscalateRes.status).toBe(400);
      const reEscalateBody = await reEscalateRes.json();
      expect(reEscalateBody.error).toMatch(/CAPA/i);

      // DB: capaId is still the same (not overwritten)
      const [ncRowAfter] = await db
        .select({ capaId: nonConformance.capaId })
        .from(nonConformance)
        .where(eq(nonConformance.id, ncId));
      expect(ncRowAfter?.capaId).toBe(capaId);
    },
  );

  // =========================================================================
  // REQ-NC-006 Unauthenticated requests → 401
  // =========================================================================
  it(
    "REQ-NC-006: unauthenticated disposition / resolve → 401",
    async () => {
      logout();

      const dispRes = await nonConformancesRouter.request("/1/disposition", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ disposition: "rework" }),
      });
      expect(dispRes.status).toBe(401);

      const resolveRes = await nonConformancesRouter.request("/1/resolve", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ correctionTaken: "Correcao realizada adequadamente" }),
      });
      expect(resolveRes.status).toBe(401);
    },
  );
});
