/**
 * unit-admin-elevation.int.spec.ts - architecture review P0-11 [HIGH RISK].
 *
 * `requirePermission` raises a member's EFFECTIVE role from the unit role
 * (`unit_admin` -> `admin`, `technician` -> `technician`) for the resources in
 * `UNIT_SCOPED_RESOURCES`, on the premise that those resources' routes filter by
 * the member's unit scope. NC, CAPA, competence, proficiency-test and SPC rows
 * are laboratory-wide and their routes carry no unit predicate, so that
 * elevation let a unit administrator approve, verify, close and escalate across
 * the whole laboratory. The five resources are out of the set: their
 * permissions follow the ORGANIZATION role alone.
 *
 * The real middleware chain (requireLabAuth -> requireOrganization ->
 * requireOrgType -> requirePermission) runs against a seeded Postgres; only the
 * Better Auth session is mocked (test/integration/setup.ts).
 *
 *   REQ-P011-1  A unit_admin whose organization role is member or technician is
 *               refused (403) every approval-grade action of the five
 *               organization-wide resources, on a probe route per action.
 *   REQ-P011-2  The same unit_admin keeps the elevated action on every resource
 *               that stays unit-scoped (standard, service, service_order,
 *               request, equipment, certificate, report, audit, calibration).
 *   REQ-P011-3  An organization admin passes every probe (positive control: the
 *               403 above is the elevation, not a broken probe).
 *   REQ-P011-4  On the real routes: unit_admin cannot verify or close a CAPA,
 *               evaluate a competence or set an NC disposition, and nothing
 *               changes; an organization admin can.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { PermissionCheck } from "@calibra-facil/auth/access";
import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  nonConformance,
  personnelCompetence,
} from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { inSequence } from "../../test/integration/in-sequence";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { capaRouter } from "./capa";
import { competencesRouter } from "./competences";
import { nonConformancesRouter } from "./non-conformances";

vi.mock("@calibra-facil/notifications", () => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCEscalatedToCapa: vi.fn().mockResolvedValue(undefined),
  notifyCompetenceRequested: vi.fn().mockResolvedValue(undefined),
  notifyCompetenceApproved: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" } as const;

type Probe = { name: string; permissions: PermissionCheck };

/** Approval-grade actions on resources whose rows are laboratory-wide. */
const ORGANIZATION_WIDE: readonly Probe[] = [
  {
    name: "non_conformance:approve_disposition",
    permissions: { non_conformance: ["approve_disposition"] },
  },
  {
    name: "non_conformance:escalate",
    permissions: { non_conformance: ["escalate"] },
  },
  { name: "capa:verify", permissions: { capa: ["verify"] } },
  { name: "capa:close", permissions: { capa: ["close"] } },
  { name: "competence:approve", permissions: { competence: ["approve"] } },
  { name: "competence:evaluate", permissions: { competence: ["evaluate"] } },
  { name: "competence:delete", permissions: { competence: ["delete"] } },
  {
    name: "proficiency_test:close",
    permissions: { proficiency_test: ["close"] },
  },
  {
    name: "proficiency_test:delete",
    permissions: { proficiency_test: ["delete"] },
  },
  { name: "spc:escalate", permissions: { spc: ["escalate"] } },
  { name: "spc:delete", permissions: { spc: ["delete"] } },
];

/** An action the admin role holds and member/technician lack, on a resource that stays unit-scoped. */
const UNIT_SCOPED: readonly Probe[] = [
  { name: "standard:create", permissions: { standard: ["create"] } },
  { name: "standard:renew", permissions: { standard: ["renew"] } },
  { name: "service:create", permissions: { service: ["create"] } },
  { name: "service_order:cancel", permissions: { service_order: ["cancel"] } },
  { name: "service_order:close", permissions: { service_order: ["close"] } },
  { name: "request:create", permissions: { request: ["create"] } },
  { name: "calibration:approve", permissions: { calibration: ["approve"] } },
  { name: "report:export", permissions: { report: ["export"] } },
  { name: "audit:export", permissions: { audit: ["export"] } },
];

/** One probe route per permission, behind the real middleware chain. */
function probeApp(probes: readonly Probe[]) {
  const app = new Hono<{ Variables: AuthVariables }>();
  probes.forEach((probe, index) => {
    app.get(`/probe/${index}`, ...withLabPermission(probe.permissions), (c) =>
      c.json({ ok: true }),
    );
  });
  return app;
}

async function statusOf(
  app: ReturnType<typeof probeApp>,
  probes: readonly Probe[],
) {
  const entries = await inSequence(
    probes,
    async (probe, index): Promise<[string, number]> => [
      probe.name,
      (await app.request(`/probe/${index}`)).status,
    ],
  );
  return Object.fromEntries(entries);
}

function expectAll(
  statuses: Record<string, number>,
  probes: readonly Probe[],
  status: number,
) {
  expect(statuses).toEqual(
    Object.fromEntries(probes.map((probe) => [probe.name, status])),
  );
}

describe("unit_admin does not elevate on organization-wide resources (P0-11)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  for (const orgRole of ["member", "technician"] as const) {
    it(`REQ-P011-1/2: a unit_admin who is org ${orgRole} is refused every organization-wide approval and keeps the unit-scoped ones`, async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      const unitAdmin = await seedExtraMember({
        orgId: org.orgId,
        userId: `user-unit-admin-${orgRole}`,
        role: orgRole,
        unitId: org.unitId,
        unitRole: "unit_admin",
      });
      loginAs({ userId: unitAdmin.userId, organizationId: org.orgId });

      const wide = probeApp(ORGANIZATION_WIDE);
      expectAll(
        await statusOf(wide, ORGANIZATION_WIDE),
        ORGANIZATION_WIDE,
        403,
      );

      const scoped = probeApp(UNIT_SCOPED);
      expectAll(await statusOf(scoped, UNIT_SCOPED), UNIT_SCOPED, 200);
    });
  }

  it("REQ-P011-3: an organization admin passes every probe", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const all = [...ORGANIZATION_WIDE, ...UNIT_SCOPED];
    expectAll(await statusOf(probeApp(all), all), all, 200);
  });

  it("REQ-P011-4: on the real routes a unit_admin cannot verify or close a CAPA, evaluate a competence or set an NC disposition", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const subject = await seedExtraMember({
      orgId: org.orgId,
      userId: "user-subject",
      role: "technician",
    });
    const unitAdmin = await seedExtraMember({
      orgId: org.orgId,
      userId: "user-unit-admin",
      role: "member",
      unitId: org.unitId,
      unitRole: "unit_admin",
    });

    const [capa] = await db
      .insert(correctiveAction)
      .values({
        capaNumber: "CAPA-P011-1",
        organizationId: org.orgId,
        source: "nc_detection",
        title: "CAPA em implementação",
        description: "Seed direto para o teste de elevação.",
        type: "corrective",
        severity: "minor",
        category: "procedure",
        status: "IMPLEMENTATION",
        createdBy: org.userId,
      })
      .returning({ id: correctiveAction.id });
    const [competence] = await db
      .insert(personnelCompetence)
      .values({
        organizationId: org.orgId,
        userId: subject.userId,
        requestedBy: subject.userId,
        createdBy: subject.userId,
        scopeDescription: "Calibração de manômetros",
        status: "PENDING_EVALUATION",
      })
      .returning({ id: personnelCompetence.id });
    const [nc] = await db
      .insert(nonConformance)
      .values({
        ncNumber: "NC-2026-P011",
        organizationId: org.orgId,
        type: "work",
        description: "Medição fora de tolerância no ensaio",
        detectedBy: org.userId,
        detectedAt: new Date("2026-01-15T10:00:00.000Z"),
        status: "open",
        createdBy: org.userId,
      })
      .returning({ id: nonConformance.id });
    if (!capa || !competence || !nc) throw new Error("seed failed");

    const verifyBody = JSON.stringify({
      effectivenessConfirmed: true,
      verificationNotes: "Eficácia confirmada em auditoria interna posterior.",
    });
    const closeBody = JSON.stringify({
      reason: "Ação corretiva concluída com eficácia confirmada.",
    });
    const dispositionBody = JSON.stringify({
      disposition: "rework",
      justification: "Retrabalho do ensaio com o padrão verificado.",
    });

    loginAs({ userId: unitAdmin.userId, organizationId: org.orgId });
    const refused = [
      await capaRouter.request(`/${capa.id}/verify`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: verifyBody,
      }),
      await capaRouter.request(`/${capa.id}/close`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: closeBody,
      }),
      await competencesRouter.request(`/${competence.id}/evaluate`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ passed: true }),
      }),
      await nonConformancesRouter.request(`/${nc.id}/disposition`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: dispositionBody,
      }),
    ];
    expect(refused.map((res) => res.status)).toEqual([403, 403, 403, 403]);

    // Nothing moved.
    const [capaAfter] = await db
      .select({
        status: correctiveAction.status,
        verifiedBy: correctiveAction.verifiedBy,
      })
      .from(correctiveAction)
      .where(eq(correctiveAction.id, capa.id));
    expect(capaAfter).toEqual({ status: "IMPLEMENTATION", verifiedBy: null });
    const [competenceAfter] = await db
      .select({
        status: personnelCompetence.status,
        approvedBy: personnelCompetence.approvedBy,
      })
      .from(personnelCompetence)
      .where(eq(personnelCompetence.id, competence.id));
    expect(competenceAfter).toEqual({
      status: "PENDING_EVALUATION",
      approvedBy: null,
    });
    const [ncAfter] = await db
      .select({
        status: nonConformance.status,
        disposition: nonConformance.disposition,
      })
      .from(nonConformance)
      .where(eq(nonConformance.id, nc.id));
    expect(ncAfter).toEqual({ status: "open", disposition: null });

    // Positive control: an organization admin does each of them.
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const allowed = [
      await capaRouter.request(`/${capa.id}/verify`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: verifyBody,
      }),
      await competencesRouter.request(`/${competence.id}/evaluate`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ passed: true }),
      }),
      await nonConformancesRouter.request(`/${nc.id}/disposition`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: dispositionBody,
      }),
    ];
    expect(allowed.map((res) => res.status)).toEqual([200, 200, 200]);
  });
});
