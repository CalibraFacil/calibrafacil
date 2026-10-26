/**
 * capa.int.spec.ts — Real-DB + real-RBAC integration tests for the ISO 17025
 * §8.2 / §10.2 Corrective Action (CAPA) workflow.
 *
 * Only the better-auth session is mocked (see test/integration/setup.ts).
 * requireLabAuth → requireOrganization → withLabPermission all run for real
 * against the seeded Postgres. No notifications or background jobs to mock:
 * capa.ts dispatches neither.
 *
 * Oracle-gated: tests assert the INTENDED ISO behaviour. Any deviation is
 * escalated rather than worked around.
 *
 * REQ-CAPA-001  Tenant isolation: org A cannot act on or read org B's CAPAs
 * REQ-CAPA-002  Strict state machine: happy lifecycle + out-of-order → 400
 * REQ-CAPA-003  RBAC: verify/close as technician → 403; implement → 200
 * REQ-CAPA-004  Immutable once CLOSED: PUT/verify/close → 400
 * REQ-CAPA-005  OPEN→INVESTIGATION auto-transition via rootCauseAnalysis
 * REQ-CAPA-006  Unauthenticated verify/close → 401
 *
 * REQ-CAPA-007  Separation of duties: the CAPA's owner (responsibleId) and the
 *               person who implemented it cannot verify its effectiveness
 *               (403 self_approval_blocked); an independent admin can.
 *
 * REQ-CAPA-008  Q50: anyone who was EVER the responsible person (audit history of
 *               responsibleId, not only the current owner) is not independent;
 *               reassign-then-verify is blocked.
 * REQ-CAPA-009  Q50: a lab with a single eligible verifier lets that person
 *               verify only with a written justification (min length), recorded
 *               in the row, the audit entry and the DTO as
 *               verification_independence: waived_single_verifier; a lab with
 *               another eligible verifier never waives; an independent verifier
 *               is flagged "independent".
 *
 * IDENTITY-SEPARATION NOTE:
 *   Verification is identity-checked (REQ-CAPA-007). Closing a CAPA is still
 *   role-based only: the person who verified may close. ISO §8.2.3 independence
 *   of the closure remains flagged for human review.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { capaRouter } from "./capa";
import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  correctiveActionAuditLog,
  member,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import { inSequence } from "../../test/integration/in-sequence";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" } as const;

// Valid payload for POST / (satisfies CreateCorrectiveActionSchema)
function makeCreatePayload(params: {
  responsibleId: string;
  title?: string;
}): Record<string, unknown> {
  return {
    title: params.title ?? "Falha no procedimento de calibração",
    description:
      "Desvio identificado no processo de verificação intermediária da balança padrão.",
    source: "nc_detection",
    sourceReference: null,
    detectionDate: "2026-06-01",
    type: "corrective",
    severity: "minor",
    category: "procedure",
    actionPlan:
      "Revisar procedimento POP-CAL-007 e retreinar equipe responsável.",
    responsibleId: params.responsibleId,
    dueDate: "2026-09-01",
    rootCauseAnalysis: null,
    rootCauseAnalysisMethod: null,
    preventiveMeasures: null,
  };
}

// ---------------------------------------------------------------------------
// Inline domain seed helper — NOT added to the shared seed.ts
// ---------------------------------------------------------------------------

/** Insert a correctiveAction row directly so tests can preset any status,
 *  including CLOSED, bypassing route validation. */
async function seedCapa(params: {
  capaNumber: string;
  organizationId: string;
  createdBy: string;
  status?:
    | "OPEN"
    | "INVESTIGATION"
    | "IMPLEMENTATION"
    | "VERIFICATION"
    | "CLOSED";
}): Promise<number> {
  const [row] = await db
    .insert(correctiveAction)
    .values({
      capaNumber: params.capaNumber,
      organizationId: params.organizationId,
      source: "nc_detection",
      title: "Test CAPA for integration",
      description: "Inserted directly to set any lifecycle status.",
      type: "corrective",
      severity: "minor",
      category: "procedure",
      status: params.status ?? "OPEN",
      createdBy: params.createdBy,
    })
    .returning({ id: correctiveAction.id });
  if (!row) throw new Error("seedCapa: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("capaRouter — ISO 17025 §8.2 CAPA workflow (real DB + real RBAC)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-CAPA-001  Tenant isolation
  // =========================================================================
  it("REQ-CAPA-001: org A cannot GET, verify, or close org B's CAPA; GET / returns only org A's CAPAs with definite count", async () => {
    const orgA = await seedOrg({
      orgId: "org-a",
      userId: "user-a",
      role: "admin",
    });
    const orgB = await seedOrg({
      orgId: "org-b",
      userId: "user-b",
      role: "admin",
    });

    // Seed 2 CAPAs for org A, 1 for org B
    await seedCapa({
      capaNumber: "CAPA-A-0001",
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      status: "OPEN",
    });
    await seedCapa({
      capaNumber: "CAPA-A-0002",
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      status: "IMPLEMENTATION",
    });
    const bCapaId = await seedCapa({
      capaNumber: "CAPA-B-0001",
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      status: "IMPLEMENTATION",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    // --- list: expect exactly 2 (org A's) ---
    const listRes = await capaRouter.request("/", { headers: JSON_HEADERS });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.pagination.total).toBe(2);
    const capaNumbers = listBody.data.map(
      (c: { capaNumber: string }) => c.capaNumber,
    );
    expect(capaNumbers).toContain("CAPA-A-0001");
    expect(capaNumbers).toContain("CAPA-A-0002");
    expect(capaNumbers).not.toContain("CAPA-B-0001");

    // --- GET org B's CAPA → 404 (no cross-tenant read) ---
    const getRes = await capaRouter.request(`/${bCapaId}`, {
      headers: JSON_HEADERS,
    });
    expect(getRes.status).toBe(404);

    // --- verify org B's CAPA → 404 (org scope blocks it before state check) ---
    const verifyRes = await capaRouter.request(`/${bCapaId}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        effectivenessConfirmed: true,
        verificationNotes: "Cross-tenant verify attempt — must not succeed.",
      }),
    });
    expect(verifyRes.status).toBe(404);

    // --- close org B's CAPA → 404 ---
    const closeRes = await capaRouter.request(`/${bCapaId}/close`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Cross-tenant close attempt." }),
    });
    expect(closeRes.status).toBe(404);

    // --- DB: org B's CAPA is untouched (still IMPLEMENTATION) ---
    const [bRow] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, bCapaId));
    expect(bRow?.status).toBe("IMPLEMENTATION");
  });

  // =========================================================================
  // REQ-CAPA-002  Strict state machine
  // =========================================================================
  it("REQ-CAPA-002: strict state machine — out-of-order transitions → 400; full happy lifecycle DB-verified", async () => {
    const org = await seedOrg({
      orgId: "org-sm",
      userId: "user-sm",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // --- 2a: verify on OPEN → 400 (must be IMPLEMENTATION) ---
    const openId = await seedCapa({
      capaNumber: "CAPA-SM-OPEN",
      organizationId: org.orgId,
      createdBy: org.userId,
      status: "OPEN",
    });

    const verifyOpenRes = await capaRouter.request(`/${openId}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        effectivenessConfirmed: true,
        verificationNotes: "Out-of-order verify on OPEN — must be blocked.",
      }),
    });
    expect(verifyOpenRes.status).toBe(400);
    const verifyOpenBody = await verifyOpenRes.json();
    expect(verifyOpenBody.error).toMatch(/IMPLEMENTATION/i);

    // DB unchanged
    const [openRow] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, openId));
    expect(openRow?.status).toBe("OPEN");

    // --- 2b: close on IMPLEMENTATION → 400 (must be VERIFICATION) ---
    const implId = await seedCapa({
      capaNumber: "CAPA-SM-IMPL",
      organizationId: org.orgId,
      createdBy: org.userId,
      status: "IMPLEMENTATION",
    });

    const closeImplRes = await capaRouter.request(`/${implId}/close`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Out-of-order close on IMPLEMENTATION." }),
    });
    expect(closeImplRes.status).toBe(400);
    const closeImplBody = await closeImplRes.json();
    expect(closeImplBody.error).toMatch(/VERIFICATION/i);

    // DB unchanged
    const [implRow] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, implId));
    expect(implRow?.status).toBe("IMPLEMENTATION");

    // --- 2c: OPEN → close directly → 400 (must be VERIFICATION) ---
    const open2Id = await seedCapa({
      capaNumber: "CAPA-SM-JUMP",
      organizationId: org.orgId,
      createdBy: org.userId,
      status: "OPEN",
    });

    const jumpCloseRes = await capaRouter.request(`/${open2Id}/close`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Jump from OPEN to CLOSED." }),
    });
    expect(jumpCloseRes.status).toBe(400);

    // DB unchanged
    const [jumpRow] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, open2Id));
    expect(jumpRow?.status).toBe("OPEN");

    // --- 2d: full happy lifecycle: OPEN → implement → verify → close ---
    const lifecycleId = await seedCapa({
      capaNumber: "CAPA-SM-HAPPY",
      organizationId: org.orgId,
      createdBy: org.userId,
      status: "OPEN",
    });

    // implement (OPEN → IMPLEMENTATION)
    const implRes = await capaRouter.request(`/${lifecycleId}/implement`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        implementationEvidence:
          "Revisão do POP-CAL-007 concluída e equipe retreinada com lista de presença.",
      }),
    });
    expect(implRes.status).toBe(200);
    const implBody = await implRes.json();
    expect(implBody.data.status).toBe("IMPLEMENTATION");

    // DB check
    const [afterImpl] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, lifecycleId));
    expect(afterImpl?.status).toBe("IMPLEMENTATION");

    // verify (IMPLEMENTATION → VERIFICATION, verifiedBy set). Separation of
    // duties: the person who implemented the CAPA does not verify it, so a
    // second admin takes over for verification and closure.
    const verifier = await seedExtraMember({
      orgId: org.orgId,
      userId: "user-capa-verifier",
      role: "admin",
    });
    loginAs({ userId: verifier.userId, organizationId: org.orgId });
    const verifyRes2 = await capaRouter.request(`/${lifecycleId}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        effectivenessConfirmed: true,
        verificationNotes:
          "Auditoria interna confirmou conformidade após 30 dias de monitoramento.",
      }),
    });
    expect(verifyRes2.status).toBe(200);
    const verifyBody2 = await verifyRes2.json();
    expect(verifyBody2.data.status).toBe("VERIFICATION");
    expect(verifyBody2.data.verifiedBy).toBe(verifier.userId);

    // DB check
    const [afterVerify] = await db
      .select({
        status: correctiveAction.status,
        verifiedBy: correctiveAction.verifiedBy,
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, lifecycleId));
    expect(afterVerify?.status).toBe("VERIFICATION");
    expect(afterVerify?.verifiedBy).toBe(verifier.userId);

    // close (VERIFICATION → CLOSED, closedBy set)
    const closeRes2 = await capaRouter.request(`/${lifecycleId}/close`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        reason: "Ação corretiva concluída com eficácia confirmada.",
      }),
    });
    expect(closeRes2.status).toBe(200);
    const closeBody2 = await closeRes2.json();
    expect(closeBody2.data.status).toBe("CLOSED");
    expect(closeBody2.data.closedBy).toBe(verifier.userId);

    // DB check
    const [afterClose] = await db
      .select({
        status: correctiveAction.status,
        closedBy: correctiveAction.closedBy,
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, lifecycleId));
    expect(afterClose?.status).toBe("CLOSED");
    expect(afterClose?.closedBy).toBe(verifier.userId);
  });

  // =========================================================================
  // REQ-CAPA-003  RBAC
  // =========================================================================
  it("REQ-CAPA-003: technician → 403 on verify/close, 200 on implement; member → 403 create/update; operator → 403 create/update", async () => {
    const adminOrg = await seedOrg({
      orgId: "org-rbac",
      userId: "user-rbac-admin",
      role: "admin",
    });

    // Add technician, member, and operator to the same org
    const techId = "user-rbac-tech";
    const membId = "user-rbac-memb";
    const opId = "user-rbac-op";

    for (const { uid, role } of [
      { uid: techId, role: "technician" as const },
      { uid: membId, role: "member" as const },
      { uid: opId, role: "operator" as const },
    ]) {
      await db.insert(user).values({
        id: uid,
        name: `User ${uid}`,
        email: `${uid}@lab.test`,
      });
      await db.insert(member).values({
        id: `member-${uid}`,
        organizationId: adminOrg.orgId,
        userId: uid,
        role,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
    }

    // Seed a CAPA in IMPLEMENTATION for verify/close attempts
    const implCapaId = await seedCapa({
      capaNumber: "CAPA-RBAC-IMPL",
      organizationId: adminOrg.orgId,
      createdBy: adminOrg.userId,
      status: "IMPLEMENTATION",
    });

    // Seed a CAPA in OPEN for implement attempt
    const openCapaId = await seedCapa({
      capaNumber: "CAPA-RBAC-OPEN",
      organizationId: adminOrg.orgId,
      createdBy: adminOrg.userId,
      status: "OPEN",
    });

    // --- technician cannot verify → 403 ---
    loginAs({ userId: techId, organizationId: adminOrg.orgId });
    const techVerifyRes = await capaRouter.request(`/${implCapaId}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        effectivenessConfirmed: true,
        verificationNotes:
          "Technician trying to verify — must be blocked by RBAC.",
      }),
    });
    expect(techVerifyRes.status, "technician verify must be 403").toBe(403);

    // --- technician cannot close → 403 (seed VERIFICATION state for this test) ---
    const verifCapaId = await seedCapa({
      capaNumber: "CAPA-RBAC-VERIF",
      organizationId: adminOrg.orgId,
      createdBy: adminOrg.userId,
      status: "VERIFICATION",
    });

    const techCloseRes = await capaRouter.request(`/${verifCapaId}/close`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        reason: "Technician trying to close — must be blocked.",
      }),
    });
    expect(techCloseRes.status, "technician close must be 403").toBe(403);

    // --- technician CAN implement → 200 ---
    const techImplRes = await capaRouter.request(`/${openCapaId}/implement`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        implementationEvidence:
          "Evidência de implementação registrada pelo técnico conforme procedimento.",
      }),
    });
    expect(techImplRes.status, "technician implement must be 200").toBe(200);
    const techImplBody = await techImplRes.json();
    expect(techImplBody.data.status).toBe("IMPLEMENTATION");

    // DB: status transitioned
    const [techImplRow] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, openCapaId));
    expect(techImplRow?.status).toBe("IMPLEMENTATION");

    // --- member cannot create → 403 ---
    loginAs({ userId: membId, organizationId: adminOrg.orgId });
    const membCreateRes = await capaRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(makeCreatePayload({ responsibleId: membId })),
    });
    expect(membCreateRes.status, "member create must be 403").toBe(403);

    // --- member cannot update → 403 ---
    const membUpdateRes = await capaRouter.request(`/${implCapaId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: "Updated by member — must be blocked" }),
    });
    expect(membUpdateRes.status, "member update must be 403").toBe(403);

    // --- operator cannot create → 403 ---
    loginAs({ userId: opId, organizationId: adminOrg.orgId });
    const opCreateRes = await capaRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(makeCreatePayload({ responsibleId: opId })),
    });
    expect(opCreateRes.status, "operator create must be 403").toBe(403);

    // --- operator cannot update → 403 ---
    const opUpdateRes = await capaRouter.request(`/${implCapaId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: "Updated by operator — must be blocked" }),
    });
    expect(opUpdateRes.status, "operator update must be 403").toBe(403);
  });

  // =========================================================================
  // REQ-CAPA-004  Immutable once CLOSED
  // =========================================================================
  it("REQ-CAPA-004: PUT a CLOSED CAPA → 400 + DB still CLOSED; verify/close on CLOSED → 400 (state guard)", async () => {
    const org = await seedOrg({
      orgId: "org-imm",
      userId: "user-imm",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const closedId = await seedCapa({
      capaNumber: "CAPA-IMM-CLOSED",
      organizationId: org.orgId,
      createdBy: org.userId,
      status: "CLOSED",
    });

    // --- PUT a CLOSED CAPA → 400 ---
    const putRes = await capaRouter.request(`/${closedId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "Updated title — should be rejected because CLOSED",
      }),
    });
    expect(putRes.status).toBe(400);
    const putBody = await putRes.json();
    expect(putBody.error).toMatch(/fechada|CLOSED/i);

    // DB still CLOSED
    const [afterPut] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, closedId));
    expect(afterPut?.status).toBe("CLOSED");

    // --- verify on CLOSED → 400 (status !== IMPLEMENTATION) ---
    const verifyClosedRes = await capaRouter.request(`/${closedId}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        effectivenessConfirmed: true,
        verificationNotes:
          "Attempting verify on already-CLOSED CAPA — must be blocked.",
      }),
    });
    expect(verifyClosedRes.status).toBe(400);

    // DB still CLOSED
    const [afterVerify] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, closedId));
    expect(afterVerify?.status).toBe("CLOSED");

    // --- close on CLOSED → 400 (status !== VERIFICATION) ---
    const closeClosedRes = await capaRouter.request(`/${closedId}/close`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        reason: "Attempting close on already-CLOSED CAPA.",
      }),
    });
    expect(closeClosedRes.status).toBe(400);

    // DB still CLOSED
    const [afterClose] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, closedId));
    expect(afterClose?.status).toBe("CLOSED");
  });

  // =========================================================================
  // REQ-CAPA-005  OPEN→INVESTIGATION auto-transition
  // =========================================================================
  it("REQ-CAPA-005: PUT with rootCauseAnalysis on an OPEN CAPA (technician) → 200 + status INVESTIGATION (DB-verified)", async () => {
    const adminOrg = await seedOrg({
      orgId: "org-inv",
      userId: "user-inv-admin",
      role: "admin",
    });

    // Add a technician
    const techId = "user-inv-tech";
    await db.insert(user).values({
      id: techId,
      name: "Technician Inv",
      email: `${techId}@lab.test`,
    });
    await db.insert(member).values({
      id: `member-${techId}`,
      organizationId: adminOrg.orgId,
      userId: techId,
      role: "technician",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const openId = await seedCapa({
      capaNumber: "CAPA-INV-OPEN",
      organizationId: adminOrg.orgId,
      createdBy: adminOrg.userId,
      status: "OPEN",
    });

    loginAs({ userId: techId, organizationId: adminOrg.orgId });

    const putRes = await capaRouter.request(`/${openId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        rootCauseAnalysis:
          "Causa raiz identificada: falta de calibração intermediária do equipamento padrão S/N 1234.",
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.status).toBe("INVESTIGATION");

    // DB verification
    const [row] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, openId));
    expect(row?.status).toBe("INVESTIGATION");
  });

  // =========================================================================
  // REQ-CAPA-006  Unauthenticated verify/close → 401
  // =========================================================================
  it("REQ-CAPA-006: unauthenticated verify and close requests → 401", async () => {
    logout();

    const verifyRes = await capaRouter.request("/999/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        effectivenessConfirmed: true,
        verificationNotes: "Unauthenticated attempt — must return 401.",
      }),
    });
    expect(verifyRes.status).toBe(401);

    const closeRes = await capaRouter.request("/999/close", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Unauthenticated close attempt." }),
    });
    expect(closeRes.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Foreign-id (tenant-refs) guard: the CAPA responsible must be a member of the
// caller's organization — otherwise GET /:id would resolve (and return) another
// tenant's user name through `responsibleName`.
// ---------------------------------------------------------------------------
describe("capaRouter — responsibleId is tenant-scoped", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TENANT-CAPA-001 [HIGH RISK]: POST / with another org's responsibleId → 400, no CAPA created", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await capaRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(makeCreatePayload({ responsibleId: orgB.userId })),
    });

    expect(res.status).toBe(400);
    const rows = await db
      .select({ id: correctiveAction.id })
      .from(correctiveAction);
    expect(rows).toHaveLength(0);
  });

  it("REQ-TENANT-CAPA-002: POST / with a same-org responsibleId → 201 and the responsible persists", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const colleague = await seedExtraMember({
      orgId: orgA.orgId,
      userId: "colleague-a",
      role: "technician",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await capaRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(
        makeCreatePayload({ responsibleId: colleague.userId }),
      ),
    });

    expect(res.status).toBe(201);
    const [row] = await db
      .select({ responsibleId: correctiveAction.responsibleId })
      .from(correctiveAction);
    expect(row?.responsibleId).toBe(colleague.userId);
  });

  it("REQ-TENANT-CAPA-003 [HIGH RISK]: PUT /:id with another org's responsibleId → 400, responsible unchanged", async () => {
    const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
    const capaId = await seedCapa({
      capaNumber: "CAPA-A-0001",
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await capaRouter.request(`/${capaId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ responsibleId: orgB.userId }),
    });

    expect(res.status).toBe(400);
    const [row] = await db
      .select({ responsibleId: correctiveAction.responsibleId })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, capaId));
    expect(row?.responsibleId).toBeNull();
  });

  // =========================================================================
  // REQ-CAPA-007  Separation of duties on effectiveness verification
  // =========================================================================
  it("REQ-CAPA-007: the owner and the implementer cannot verify; an independent admin can", async () => {
    const org = await seedOrg({
      orgId: "org-sod",
      userId: "user-sod-implementer",
      role: "admin",
    });
    const owner = await seedExtraMember({
      orgId: org.orgId,
      userId: "user-sod-owner",
      role: "admin",
    });
    const independent = await seedExtraMember({
      orgId: org.orgId,
      userId: "user-sod-independent",
      role: "admin",
    });

    const [row] = await db
      .insert(correctiveAction)
      .values({
        capaNumber: "CAPA-SOD-1",
        organizationId: org.orgId,
        source: "nc_detection",
        title: "CAPA com responsável",
        description: "Responsável definido para o teste de segregação.",
        type: "corrective",
        severity: "minor",
        category: "procedure",
        status: "OPEN",
        responsibleId: owner.userId,
        createdBy: org.userId,
      })
      .returning({ id: correctiveAction.id });
    if (!row) throw new Error("seed failed");
    const id = row.id;

    // The implementer records the implementation...
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const implementRes = await capaRouter.request(`/${id}/implement`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        implementationEvidence:
          "Procedimento revisado e equipe retreinada, com lista de presença.",
      }),
    });
    expect(implementRes.status).toBe(200);

    const verifyBody = JSON.stringify({
      effectivenessConfirmed: true,
      verificationNotes: "Eficácia confirmada em auditoria interna posterior.",
    });
    const stillImplemented = async () => {
      const [after] = await db
        .select({
          status: correctiveAction.status,
          verifiedBy: correctiveAction.verifiedBy,
        })
        .from(correctiveAction)
        .where(eq(correctiveAction.id, id));
      expect(after).toEqual({ status: "IMPLEMENTATION", verifiedBy: null });
    };

    // ...and cannot verify it.
    const implementerVerify = await capaRouter.request(`/${id}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: verifyBody,
    });
    expect(implementerVerify.status).toBe(403);
    expect((await implementerVerify.json()).code).toBe("self_approval_blocked");
    await stillImplemented();

    // The owner (responsibleId) cannot verify it either.
    loginAs({ userId: owner.userId, organizationId: org.orgId });
    const ownerVerify = await capaRouter.request(`/${id}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: verifyBody,
    });
    expect(ownerVerify.status).toBe(403);
    expect((await ownerVerify.json()).code).toBe("self_approval_blocked");
    await stillImplemented();

    // An independent admin can.
    loginAs({ userId: independent.userId, organizationId: org.orgId });
    const independentVerify = await capaRouter.request(`/${id}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: verifyBody,
    });
    expect(independentVerify.status).toBe(200);
    const [verified] = await db
      .select({
        status: correctiveAction.status,
        verifiedBy: correctiveAction.verifiedBy,
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, id));
    expect(verified).toEqual({
      status: "VERIFICATION",
      verifiedBy: independent.userId,
    });
  });

  // =========================================================================
  // REQ-CAPA-008  Anyone who was ever responsible is not independent (Q50)
  // =========================================================================
  it("REQ-CAPA-008: reassigning the CAPA does not make the former owner independent; an admin who never touched it can verify", async () => {
    const creator = await seedOrg({
      orgId: "org-hist",
      userId: "user-hist-creator",
      role: "admin",
    });
    const first = await seedExtraMember({
      orgId: creator.orgId,
      userId: "user-hist-first-owner",
      role: "admin",
    });
    const second = await seedExtraMember({
      orgId: creator.orgId,
      userId: "user-hist-second-owner",
      role: "admin",
    });

    loginAs({ userId: creator.userId, organizationId: creator.orgId });
    const created = await capaRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(makeCreatePayload({ responsibleId: first.userId })),
    });
    expect(created.status).toBe(201);
    const id: number = (await created.json()).id;

    // Ownership moves to the second admin, who also implements it.
    const reassigned = await capaRouter.request(`/${id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ responsibleId: second.userId }),
    });
    expect(reassigned.status).toBe(200);
    loginAs({ userId: second.userId, organizationId: creator.orgId });
    expect(
      (
        await capaRouter.request(`/${id}/implement`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            implementationEvidence:
              "Procedimento revisado e equipe retreinada.",
          }),
        })
      ).status,
    ).toBe(200);

    const body = JSON.stringify({
      effectivenessConfirmed: true,
      verificationNotes: "Eficácia confirmada em auditoria interna posterior.",
    });
    // The FIRST owner is no longer `responsibleId`, but the audit history names
    // them: blocked. So is the current owner/implementer.
    const refusals = await inSequence(
      [first.userId, second.userId],
      async (blocked) => {
        loginAs({ userId: blocked, organizationId: creator.orgId });
        const res = await capaRouter.request(`/${id}/verify`, {
          method: "POST",
          headers: JSON_HEADERS,
          body,
        });
        return { status: res.status, body: await res.json() };
      },
    );
    for (const refusal of refusals) {
      expect(refusal.status).toBe(403);
      expect(refusal.body.code).toBe("self_approval_blocked");
      // Another eligible verifier exists, so no waiver is on offer.
      expect(refusal.body.details).toEqual({
        independence_waiver_available: false,
      });
    }

    // The creator (never responsible, never implemented) is independent.
    loginAs({ userId: creator.userId, organizationId: creator.orgId });
    const verified = await capaRouter.request(`/${id}/verify`, {
      method: "POST",
      headers: JSON_HEADERS,
      body,
    });
    expect(verified.status).toBe(200);
    const [row] = await db
      .select({
        verifiedBy: correctiveAction.verifiedBy,
        independence: correctiveAction.verificationIndependence,
        justification: correctiveAction.verificationIndependenceJustification,
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, id));
    expect(row).toEqual({
      verifiedBy: creator.userId,
      independence: "independent",
      justification: null,
    });
  });

  // =========================================================================
  // REQ-CAPA-009  The sole eligible verifier may verify with a justification (Q50)
  // =========================================================================
  it("REQ-CAPA-009: a lab with one eligible verifier needs a written justification; a normal lab never waives", async () => {
    const sole = await seedOrg({
      orgId: "org-sole",
      userId: "user-sole-admin",
      role: "admin",
    });
    // Neither a technician (cannot verify) nor a banned admin is an alternative.
    await seedExtraMember({
      orgId: sole.orgId,
      userId: "user-sole-technician",
      role: "technician",
    });
    const banned = await seedExtraMember({
      orgId: sole.orgId,
      userId: "user-sole-banned-admin",
      role: "admin",
    });
    await db
      .update(user)
      .set({ banned: true })
      .where(eq(user.id, banned.userId));

    const capaId = await seedCapa({
      capaNumber: "CAPA-SOLE-1",
      organizationId: sole.orgId,
      createdBy: sole.userId,
      status: "OPEN",
    });
    await db
      .update(correctiveAction)
      .set({ responsibleId: sole.userId })
      .where(eq(correctiveAction.id, capaId));

    loginAs({ userId: sole.userId, organizationId: sole.orgId });
    expect(
      (
        await capaRouter.request(`/${capaId}/implement`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            implementationEvidence:
              "Procedimento revisado e equipe retreinada.",
          }),
        })
      ).status,
    ).toBe(200);

    const verify = (extra: Record<string, unknown>) =>
      capaRouter.request(`/${capaId}/verify`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          effectivenessConfirmed: true,
          verificationNotes:
            "Eficácia confirmada em auditoria interna posterior.",
          ...extra,
        }),
      });

    // No justification: refused, and the response says a waiver is available.
    const noJustification = await verify({});
    expect(noJustification.status).toBe(403);
    const refusal = await noJustification.json();
    expect(refusal.code).toBe("self_approval_blocked");
    expect(refusal.details).toEqual({ independence_waiver_available: true });

    // A justification below the minimum length is a validation error.
    expect((await verify({ independenceJustification: "só eu" })).status).toBe(
      400,
    );

    const [still] = await db
      .select({ status: correctiveAction.status })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, capaId));
    expect(still?.status).toBe("IMPLEMENTATION");

    const justification =
      "Laboratório com um único administrador; não há outro verificador habilitado.";
    const waived = await verify({ independenceJustification: justification });
    expect(waived.status).toBe(200);
    const waivedBody = await waived.json();
    expect(waivedBody.data).toMatchObject({
      status: "VERIFICATION",
      verifiedBy: sole.userId,
      verificationIndependence: "waived_single_verifier",
      verificationIndependenceJustification: justification,
    });

    // The CAPA DTO carries it.
    const detail = await capaRouter.request(`/${capaId}`, {
      headers: JSON_HEADERS,
    });
    expect(await detail.json()).toMatchObject({
      verificationIndependence: "waived_single_verifier",
      verificationIndependenceJustification: justification,
    });

    // The audit entry records the flag and the justification.
    const audit = await db
      .select({ changes: correctiveActionAuditLog.changes })
      .from(correctiveActionAuditLog)
      .where(eq(correctiveActionAuditLog.capaId, capaId));
    expect(audit.map((row) => row.changes)).toContainEqual(
      expect.objectContaining({
        verification_independence: "waived_single_verifier",
        independenceJustification: justification,
      }),
    );

    // A normal lab: with another eligible admin the owner is refused even WITH a
    // justification, and an independent verifier is flagged "independent" (the
    // justification, if sent, is not kept).
    const normal = await seedOrg({
      orgId: "org-normal",
      userId: "user-normal-owner",
      role: "admin",
    });
    const peer = await seedExtraMember({
      orgId: normal.orgId,
      userId: "user-normal-peer",
      role: "admin",
    });
    const normalCapa = await seedCapa({
      capaNumber: "CAPA-NORMAL-1",
      organizationId: normal.orgId,
      createdBy: normal.userId,
      status: "IMPLEMENTATION",
    });
    await db
      .update(correctiveAction)
      .set({ responsibleId: normal.userId })
      .where(eq(correctiveAction.id, normalCapa));
    const verifyNormal = (extra: Record<string, unknown>) =>
      capaRouter.request(`/${normalCapa}/verify`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          effectivenessConfirmed: true,
          verificationNotes:
            "Eficácia confirmada em auditoria interna posterior.",
          ...extra,
        }),
      });

    loginAs({ userId: normal.userId, organizationId: normal.orgId });
    const ownerWithJustification = await verifyNormal({
      independenceJustification: justification,
    });
    expect(ownerWithJustification.status).toBe(403);
    expect((await ownerWithJustification.json()).details).toEqual({
      independence_waiver_available: false,
    });

    loginAs({ userId: peer.userId, organizationId: normal.orgId });
    expect(
      (await verifyNormal({ independenceJustification: justification })).status,
    ).toBe(200);
    const [independentRow] = await db
      .select({
        independence: correctiveAction.verificationIndependence,
        justification: correctiveAction.verificationIndependenceJustification,
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, normalCapa));
    expect(independentRow).toEqual({
      independence: "independent",
      justification: null,
    });
  });
});
