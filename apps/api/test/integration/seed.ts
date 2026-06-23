import { db } from "@calibra-facil/db";
import {
  user,
  organization,
  organizationUnit,
  member,
} from "@calibra-facil/db/schema";

export type SeededOrg = {
  orgId: string;
  userId: string;
  memberId: string;
  unitId: number;
};

/**
 * Seed the minimum for `requireOrganization` + unit-scope resolution to succeed:
 * one user + one LAB organization + its default unit ("Matriz") + one member.
 * Scoped-role unit assignments self-heal via `ensureDefaultUnitAssignment` in
 * the real middleware, so they are intentionally not seeded here.
 */
export async function seedOrg(params?: {
  orgId?: string;
  userId?: string;
  role?: "owner" | "admin" | "technician" | "operator" | "member";
}): Promise<SeededOrg> {
  const orgId = params?.orgId ?? "org-1";
  const userId = params?.userId ?? `user-${orgId}`;
  const role = params?.role ?? "admin";
  const memberId = `member-${orgId}-${userId}`;
  const now = new Date("2026-01-01T00:00:00.000Z");

  await db.insert(user).values({
    id: userId,
    name: `User ${userId}`,
    email: `${userId}@lab.test`,
  });

  await db.insert(organization).values({
    id: orgId,
    name: `Lab ${orgId}`,
    slug: orgId,
    createdAt: now,
    type: "LAB",
    status: "ACTIVE",
  });

  const [unit] = await db
    .insert(organizationUnit)
    .values({
      organizationId: orgId,
      name: "Matriz",
      slug: "matriz",
      status: "ACTIVE",
      isDefault: true,
      createdBy: userId,
    })
    .returning({ id: organizationUnit.id });

  await db.insert(member).values({
    id: memberId,
    organizationId: orgId,
    userId,
    role,
    createdAt: now,
  });

  if (!unit) throw new Error("seedOrg: failed to create default unit");
  return { orgId, userId, memberId, unitId: unit.id };
}

/** Seed a service row scoped to an org + unit. Returns the created service id. */
export async function seedService(params: {
  organizationId: string;
  unitId: number;
  name: string;
  isActive?: boolean;
}): Promise<number> {
  const { service } = await import("@calibra-facil/db/schema");
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name,
      isActive: params.isActive ?? true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/** Seed a reference standard row scoped to an org + unit. Returns the created row id. */
export async function seedStandard(params: {
  organizationId: string;
  unitId: number;
  createdBy: string;
  name?: string;
}): Promise<number> {
  const { referenceStandard } = await import("@calibra-facil/db/schema");
  const now = new Date("2026-01-01T00:00:00.000Z");
  const nextYear = new Date("2027-01-01T00:00:00.000Z");
  const [row] = await db
    .insert(referenceStandard)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      createdBy: params.createdBy,
      name: params.name ?? "Padrão de Teste",
      kind: "generic_scalar",
      serialNumber: `SN-${params.organizationId}-${params.unitId}`,
      certificateNumber: `CERT-${params.organizationId}`,
      calibrationDate: now,
      nextCalibrationDate: nextYear,
      coverageFactor: 2.0,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 100.0,
      uncertainty: 0.05,
    })
    .returning({ id: referenceStandard.id });
  if (!row) throw new Error("seedStandard: insert failed");
  return row.id;
}
