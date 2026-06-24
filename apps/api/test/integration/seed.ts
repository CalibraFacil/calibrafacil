import { db } from "@calibra-facil/db";
import {
  user,
  organization,
  organizationUnit,
  member,
  organizationApiKey,
  entitlementOverride,
  customer,
} from "@calibra-facil/db/schema";
import { createApiKeySecret } from "../../src/lib/api-keys";

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

// =============================================================================
// External integrator API (api-key auth) — seed helpers
// =============================================================================
// These cover the auth path used by the public integrator routers
// (`requireApiKeyAuth` -> sha-256 hash lookup of `organization_api_key` ->
// `organizationHasEntitlement(orgId, "api")` -> `requireApiScope`). No session
// mock is involved: the request authenticates purely from a real seeded key, so
// the org-id discriminator is exercised end to end against the seeded DB.

export type SeededApiKey = {
  /** The plaintext key to send as `Authorization: Bearer <rawKey>` (or `x-api-key`). */
  rawKey: string;
  keyId: string;
  keyPrefix: string;
};

/**
 * Seed a real `organization_api_key` row whose `keyHash` is computed with the
 * SAME hash function the production middleware uses (`createApiKeySecret` ->
 * `hashApiKey`). Returns the matching plaintext so a test can authenticate with
 * the real `requireApiKeyAuth` — no mock. `scopes` are stored verbatim so a key
 * can be seeded with or without a given `requireApiScope` gate. A non-null
 * `revokedAt` produces a key the middleware treats as invalid (it filters
 * `isNull(revokedAt)`).
 */
export async function seedApiKey(params: {
  organizationId: string;
  createdBy: string;
  scopes: string[];
  keyId?: string;
  name?: string;
  revokedAt?: Date | null;
}): Promise<SeededApiKey> {
  const { key, keyPrefix, keyHash } = createApiKeySecret();
  const keyId = params.keyId ?? `apikey-${params.organizationId}`;
  await db.insert(organizationApiKey).values({
    id: keyId,
    organizationId: params.organizationId,
    name: params.name ?? `Test key ${keyId}`,
    keyPrefix,
    keyHash,
    scopes: params.scopes,
    createdBy: params.createdBy,
    revokedAt: params.revokedAt ?? null,
  });
  return { rawKey: key, keyId, keyPrefix };
}

/**
 * Grant the "api" feature to an org via a backoffice entitlement override
 * (grant-only, no subscription/plan needed). `requireApiKeyAuth` calls
 * `organizationHasEntitlement(orgId, "api")`, which returns true when this row
 * is present and unexpired — so a seeded key on a FREE org can still pass the
 * plan gate without seeding a full subscription.
 */
export async function seedApiEntitlement(params: {
  organizationId: string;
  feature?: string;
}): Promise<void> {
  await db.insert(entitlementOverride).values({
    organizationId: params.organizationId,
    feature: params.feature ?? "api",
    reason: "integration test grant",
    expiresAt: null,
  });
}

/**
 * Seed a `customer` owned by a LAB org. The public integrator routes scope by
 * `eq(customer.labOrganizationId, apiKey.organizationId)`, so `labOrganizationId`
 * is the tenant boundary under test. A customer also needs an `authOrganizationId`
 * (its CLIENT org for portal access); a minimal CLIENT org is created for it.
 * Returns the created customer id.
 */
export async function seedCustomer(params: {
  labOrganizationId: string;
  name: string;
  authOrganizationId?: string;
  taxId?: string;
}): Promise<number> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const clientOrgId =
    params.authOrganizationId ??
    `client-${params.labOrganizationId}-${Math.random().toString(36).slice(2, 8)}`;

  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: now,
  });

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      taxId: params.taxId ?? null,
      authOrganizationId: clientOrgId,
      labOrganizationId: params.labOrganizationId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}
