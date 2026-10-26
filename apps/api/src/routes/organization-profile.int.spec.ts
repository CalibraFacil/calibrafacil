/**
 * organization-profile.int.spec.ts - architecture review P0-1.
 *
 * The laboratory profile (CNPJ, accreditation claim, address, contacts, technical
 * manager) is `input: false` in Better Auth and written by
 * `PATCH /api/organization/profile` alone. Real middleware, real database.
 *
 *   REQ-P01-PROF-1  admin and owner write the profile; the row, the response and
 *                   the audit event agree (accreditation before/after recorded).
 *   REQ-P01-PROF-2  a field that is absent is left alone; null or "" clears it.
 *   REQ-P01-PROF-3  technician, operator and member are refused (403), and the
 *                   row is unchanged.
 *   REQ-P01-PROF-4  only the caller's own laboratory changes; type, id and slug
 *                   in the body are ignored.
 *   REQ-P01-PROF-5  an invalid date or UF is a 400 and nothing is written;
 *                   unauthenticated is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { organization, organizationEventLog } from "@calibra-facil/db/schema";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { inSequence } from "../../test/integration/in-sequence";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import { organizationProfileRouter } from "./organization-profile";

const JSON_HEADERS = { "content-type": "application/json" } as const;

function patch(body: unknown) {
  return organizationProfileRouter.request("/profile", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function profileOf(orgId: string) {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, orgId));
  if (!row) throw new Error(`organization ${orgId} vanished`);
  return row;
}

const CLAIM = {
  cnpj: "11.222.333/0001-81",
  accreditationNumber: "0123",
  accreditationBody: "Cgcre",
  accreditationActive: true,
  accreditationValidFrom: "2026-01-01T03:00:00.000Z",
  accreditationValidUntil: "2030-12-31T23:59:59.999Z",
  permissionariaAuthorizationNumber: "RBMLQ-77",
  permissionariaAuthorizationState: "SP",
  street: "Rua das Flores",
  city: "São Paulo",
  state: "SP",
  phone: "11999990000",
  email: "contato@lab.test",
  technicalManagerName: "Maria Responsável",
  technicalManagerTitle: "Gerente técnica",
};

describe("organizationProfileRouter (PATCH /profile)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-P01-PROF-1: an admin writes the profile; the row, the response and the audit event agree", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await patch(CLAIM);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      cnpj: CLAIM.cnpj,
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      accreditationValidFrom: "2026-01-01T00:00:00.000Z",
      permissionariaAuthorizationState: "SP",
      technicalManagerName: "Maria Responsável",
    });

    const row = await profileOf(org.orgId);
    expect(row).toMatchObject({
      type: "LAB",
      cnpj: CLAIM.cnpj,
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      permissionariaAuthorizationNumber: "RBMLQ-77",
      street: "Rua das Flores",
      email: "contato@lab.test",
    });
    expect(row.accreditationValidFrom?.toISOString().slice(0, 10)).toBe(
      "2026-01-01",
    );

    const events = await db
      .select()
      .from(organizationEventLog)
      .where(eq(organizationEventLog.organizationId, org.orgId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "organization.profile.updated",
      entityType: "organization",
      entityId: org.orgId,
      actorUserId: org.userId,
      actorMemberId: org.memberId,
    });
    expect(events[0]?.details).toMatchObject({
      fields: expect.arrayContaining(["accreditationActive"]),
      accreditation: expect.arrayContaining([
        { field: "accreditationActive", from: false, to: true },
        { field: "accreditationNumber", from: null, to: "0123" },
      ]),
    });
  });

  it("REQ-P01-PROF-1: an owner can write the profile too", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await patch({ accreditationBody: "Cgcre" });
    expect(res.status).toBe(200);
    expect((await profileOf(org.orgId)).accreditationBody).toBe("Cgcre");
  });

  it("REQ-P01-PROF-2: absent fields stay, null and the empty string clear", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    expect((await patch(CLAIM)).status).toBe(200);

    const res = await patch({
      accreditationBody: null,
      accreditationValidUntil: "",
      website: "  https://lab.test  ",
    });
    expect(res.status).toBe(200);

    const row = await profileOf(org.orgId);
    expect(row.accreditationBody).toBeNull();
    expect(row.accreditationValidUntil).toBeNull();
    expect(row.website).toBe("https://lab.test");
    // Untouched.
    expect(row.accreditationNumber).toBe("0123");
    expect(row.accreditationActive).toBe(true);
    expect(row.cnpj).toBe(CLAIM.cnpj);

    // An empty body changes nothing and writes no event.
    const events = await db.select().from(organizationEventLog);
    const before = events.length;
    expect((await patch({})).status).toBe(200);
    expect((await db.select().from(organizationEventLog)).length).toBe(before);
  });

  it("REQ-P01-PROF-3: technician, operator and member are refused and the row is unchanged", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const statuses = await inSequence(
      ["technician", "operator", "member"] as const,
      async (role) => {
        const extra = await seedExtraMember({
          orgId: org.orgId,
          userId: `user-${role}`,
          role,
        });
        loginAs({ userId: extra.userId, organizationId: org.orgId });
        const res = await patch({ accreditationActive: true, cnpj: "1" });
        return `${role}:${res.status}`;
      },
    );
    expect(statuses).toEqual(["technician:403", "operator:403", "member:403"]);

    const row = await profileOf(org.orgId);
    expect(row.accreditationActive).toBe(false);
    expect(row.cnpj).toBeNull();
    expect(await db.select().from(organizationEventLog)).toHaveLength(0);
  });

  it("REQ-P01-PROF-4: only the caller's laboratory changes, and type, id and slug in the body are ignored", async () => {
    const a = await seedOrg({ orgId: "org-a", role: "admin" });
    const b = await seedOrg({ orgId: "org-b", role: "admin" });
    loginAs({ userId: a.userId, organizationId: a.orgId });

    const res = await patch({
      ...CLAIM,
      type: "CLIENT",
      id: b.orgId,
      organizationId: b.orgId,
      slug: "tomada",
    });
    expect(res.status).toBe(200);

    const rowA = await profileOf(a.orgId);
    expect(rowA.type).toBe("LAB");
    expect(rowA.slug).toBe("org-a");
    expect(rowA.accreditationActive).toBe(true);
    const rowB = await profileOf(b.orgId);
    expect(rowB).toMatchObject({
      type: "LAB",
      slug: "org-b",
      cnpj: null,
      accreditationActive: false,
      accreditationNumber: null,
    });
  });

  it("REQ-P01-PROF-5: an invalid date or UF is a 400 and writes nothing; unauthenticated is 401", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const refusals = await inSequence(
      [
        { accreditationValidFrom: "not-a-date" },
        { permissionariaAuthorizationState: "SPX" },
        { accreditationActive: "yes" },
      ],
      async (bad) => (await patch({ cnpj: "99", ...bad })).status,
    );
    expect(refusals).toEqual([400, 400, 400]);
    expect((await profileOf(org.orgId)).cnpj).toBeNull();

    logout();
    expect((await patch({ cnpj: "1" })).status).toBe(401);
  });
});
