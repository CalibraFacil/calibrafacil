import { db } from "@calibra-facil/db";
import {
  user,
  organization,
  organizationUnit,
  customer,
  organizationIntegration,
  integrationConnection,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import { encryptPassword } from "@calibra-facil/signing";
import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";
import type { IntegrationSyncTarget } from "@calibra-facil/shared";
import { TEST_INTEGRATIONS_MASTER_KEY } from "./env";

export type SeededOrg = {
  orgId: string;
  userId: string;
  unitId: number;
};

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/**
 * Seed one LAB organization + its owner user + a default unit. The customer rows
 * the integration sync reads use this org as BOTH the auth-org and the lab-org
 * (customer.authOrganizationId / labOrganizationId both FK organization.id).
 */
export async function seedOrg(params?: {
  orgId?: string;
  userId?: string;
}): Promise<SeededOrg> {
  const orgId = params?.orgId ?? "org-1";
  const userId = params?.userId ?? `user-${orgId}`;

  await db.insert(user).values({
    id: userId,
    name: `User ${userId}`,
    email: `${userId}@lab.test`,
  });

  await db.insert(organization).values({
    id: orgId,
    name: `Lab ${orgId}`,
    slug: orgId,
    createdAt: EPOCH,
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
    .returning();

  if (!unit) throw new Error("seedOrg: failed to create default unit");
  return { orgId, userId, unitId: unit.id };
}

/**
 * Seed an ACTIVE generic_http financial-ERP integration for an org: the
 * `organization_integration` row plus its `integration_connection` (a valid
 * encrypted bearer secret + normalized config). `last_validated_at` is set and
 * `last_validation_error` is null so the sync is NOT blocked by the
 * VALIDATION_REQUIRED dependency warning.
 */
export async function seedIntegration(params: {
  integrationId: string;
  organizationId: string;
  createdBy: string;
  baseUrl?: string;
}): Promise<{ integrationId: string }> {
  const baseUrl = params.baseUrl ?? "https://erp.example.test";
  const config = normalizeGenericFinancialErpConfig({ baseUrl });
  const { encryptedPassword, iv } = encryptPassword(
    "test-bearer-secret",
    TEST_INTEGRATIONS_MASTER_KEY,
  );

  await db.insert(organizationIntegration).values({
    id: params.integrationId,
    organizationId: params.organizationId,
    type: "financial_erp",
    provider: "generic_http",
    name: "ERP de Teste",
    status: "ACTIVE",
    createdBy: params.createdBy,
    lastValidatedAt: EPOCH,
    lastValidationError: null,
    createdAt: EPOCH,
  });

  await db.insert(integrationConnection).values({
    id: `conn-${params.integrationId}`,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    credentialType: "bearer",
    config,
    encryptedSecret: encryptedPassword,
    secretIv: iv,
    createdBy: params.createdBy,
    createdAt: EPOCH,
  });

  return { integrationId: params.integrationId };
}

/** Seed a customer scoped to a lab org. Returns the serial id. */
export async function seedCustomer(params: {
  labOrganizationId: string;
  name: string;
  taxId?: string;
  email?: string;
}): Promise<number> {
  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      taxId: params.taxId ?? null,
      email: params.email ?? null,
      // Both FKs point at the lab org (no separate client org needed for sync).
      authOrganizationId: params.labOrganizationId,
      labOrganizationId: params.labOrganizationId,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/**
 * Pre-create the PENDING `integration_sync_run` row the worker handler updates
 * by id (`message.runId`). The API normally creates this before enqueueing; in
 * the test we create it directly so processIntegrationSync can move it to
 * RUNNING -> COMPLETED.
 */
export async function seedSyncRun(params: {
  runId: string;
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
}): Promise<{ runId: string }> {
  await db.insert(integrationSyncRun).values({
    id: params.runId,
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    trigger: "manual",
    target: params.target,
    status: "PENDING",
    createdAt: EPOCH,
  });
  return { runId: params.runId };
}
