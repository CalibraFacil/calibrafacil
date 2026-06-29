import { db } from "@calibra-facil/db";
import {
  user,
  member,
  organization,
  organizationUnit,
  personnelCompetence,
  referenceStandard,
  scheduledNotification,
  asset,
  assetType,
  customer,
} from "@calibra-facil/db/schema";
import type {
  AssetStatus,
  CompetenceStatus,
  MetrologyRegime,
  NotificationType,
  ScheduledNotificationEntityType,
} from "@calibra-facil/db/schema";

// Seed helpers for the processScheduledNotifications integration spec. Kept in a
// SEPARATE file from the shared `seed.ts` (which serves the integrations spec) so
// parallel work on either spec never conflicts. Same conventions as seed.ts: seed
// through the REAL `@calibra-facil/db` drizzle singleton (pointed at the test
// Postgres by setup.ts); the worker handler connects to the same DATABASE_URL via
// its own raw pg.Client, so seed (drizzle) and handler (pg) share one physical DB.
//
// The daily sweep compares against CURRENT_DATE (Postgres clock), so callers
// supply expiry/next-calibration dates RELATIVE to "now" via the `daysFromNow`
// helper below — never a frozen EPOCH — otherwise a fixed past date would silently
// fall out of the sweep's date windows.

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** A date `days` from the wall clock (negative = in the past). Date-only (UTC midnight). */
export function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type SeededScheduledOrg = {
  orgId: string;
  ownerUserId: string;
  unitId: number;
};

/**
 * Seed one LAB organization + its owner user + a default unit, WITHOUT any
 * admin/owner `member` row. The notify* helpers the sweep calls resolve their
 * recipients via getRecipientsByRole(org, ["admin","owner"]) reading the `member`
 * table; with zero such members they no-op (no email, no `notification` insert),
 * which keeps the DB effects under assertion (status / scheduled_notification /
 * audit log) clean. Tests that WANT recipient fan-out call seedMember() too.
 */
export async function seedScheduledOrg(params?: {
  orgId?: string;
  userId?: string;
}): Promise<SeededScheduledOrg> {
  const orgId = params?.orgId ?? "org-1";
  const ownerUserId = params?.userId ?? `user-${orgId}`;

  await db.insert(user).values({
    id: ownerUserId,
    name: `Owner ${ownerUserId}`,
    email: `${ownerUserId}@lab.test`,
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
      createdBy: ownerUserId,
    })
    .returning();

  if (!unit) throw new Error("seedScheduledOrg: failed to create default unit");
  return { orgId, ownerUserId, unitId: unit.id };
}

/** Seed an extra `user` row (e.g. the technician a competence belongs to). */
export async function seedUser(params: {
  userId: string;
  name?: string;
}): Promise<{ userId: string }> {
  await db.insert(user).values({
    id: params.userId,
    name: params.name ?? `User ${params.userId}`,
    email: `${params.userId}@lab.test`,
  });
  return { userId: params.userId };
}

/** Seed an org membership so getRecipientsByRole() can resolve this user. */
export async function seedMember(params: {
  memberId: string;
  organizationId: string;
  userId: string;
  role?: string;
}): Promise<{ memberId: string }> {
  await db.insert(member).values({
    id: params.memberId,
    organizationId: params.organizationId,
    userId: params.userId,
    role: params.role ?? "member",
    createdAt: EPOCH,
  });
  return { memberId: params.memberId };
}

/**
 * Seed a personnel_competence row. Defaults model the sweep's auto-expire target:
 * status ACTIVE with an already-past `expiresAt` (and deletedAt null), which is
 * exactly the WHERE of checkCompetencesExpired (status='ACTIVE' AND deleted_at IS
 * NULL AND expires_at < CURRENT_DATE). Returns the serial id.
 */
export async function seedCompetence(params: {
  organizationId: string;
  userId: string;
  scopeDescription?: string;
  status?: CompetenceStatus;
  expiresAt?: Date | null;
  deletedAt?: Date | null;
}): Promise<number> {
  const [row] = await db
    .insert(personnelCompetence)
    .values({
      organizationId: params.organizationId,
      userId: params.userId,
      scopeDescription: params.scopeDescription ?? "Calibração de massa",
      status: params.status ?? "ACTIVE",
      expiresAt: params.expiresAt === undefined ? daysFromNow(-3) : params.expiresAt,
      deletedAt: params.deletedAt ?? null,
      requestedBy: params.userId,
      createdBy: params.userId,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedCompetence: insert failed");
  return row.id;
}

/**
 * Seed a reference_standard row. Defaults model an EXPIRED standard
 * (next_calibration_date in the past, status ACTIVE) — the target of
 * checkStandardsExpired (ISO 17025 Clause 6.4.6). Override nextCalibrationDate to
 * land it in the EXPIRING window instead. Returns the serial id.
 */
export async function seedReferenceStandard(params: {
  organizationId: string;
  unitId: number;
  createdBy: string;
  name?: string;
  serialNumber?: string;
  certificateNumber?: string;
  nextCalibrationDate?: Date;
  status?: "ACTIVE" | "INACTIVE";
}): Promise<number> {
  const [row] = await db
    .insert(referenceStandard)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name ?? "Conjunto de Pesos E2",
      serialNumber: params.serialNumber ?? "SN-STD-1",
      certificateNumber: params.certificateNumber ?? "CERT-STD-1",
      calibrationDate: daysFromNow(-400),
      nextCalibrationDate: params.nextCalibrationDate ?? daysFromNow(-5),
      status: params.status ?? "ACTIVE",
      createdBy: params.createdBy,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedReferenceStandard: insert failed");
  return row.id;
}

export type SeededScheduledAsset = {
  assetId: number;
  customerId: number;
  assetTypeId: number;
};

/**
 * Seed one customer-owned `asset` (with its customer + asset_type) scoped to an
 * org + unit, for the legal-verification reminder sweep. The asset's recalibration
 * track (`nextCalibrationDate`) and legal-metrology track (`metrologyRegime` +
 * `regulatedInterval` + `nextLegalVerificationDate`) are set INDEPENDENTLY so a
 * test can place an instrument in either / both windows.
 *
 * `tag` is unique across the lab (asset.tag) and also seeds a unique asset_type
 * slug, so callers pass a distinct tag per asset. Dates default to NULL — set
 * `nextLegalVerificationDate` relative to "now" via `daysFromNow` to land it in
 * the sweep's BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 days window.
 */
export async function seedScheduledAsset(params: {
  organizationId: string;
  unitId: number;
  tag: string;
  customerName?: string;
  name?: string;
  serialNumber?: string;
  status?: AssetStatus;
  metrologyRegime?: MetrologyRegime;
  nextLegalVerificationDate?: Date | null;
  nextCalibrationDate?: Date | null;
  regulatedInterval?: Record<string, unknown> | null;
}): Promise<SeededScheduledAsset> {
  const [cust] = await db
    .insert(customer)
    .values({
      name: params.customerName ?? `Cliente ${params.tag}`,
      authOrganizationId: params.organizationId,
      labOrganizationId: params.organizationId,
      createdAt: EPOCH,
    })
    .returning();
  if (!cust) throw new Error("seedScheduledAsset: customer insert failed");

  const [type] = await db
    .insert(assetType)
    .values({
      name: "Balança Digital",
      slug: `tipo-${params.tag.toLowerCase()}`,
      definition: [],
      createdAt: EPOCH,
    })
    .returning();
  if (!type) throw new Error("seedScheduledAsset: asset_type insert failed");

  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: cust.id,
      assetTypeId: type.id,
      name: params.name ?? "Balança de Bancada",
      serialNumber: params.serialNumber ?? `SN-${params.tag}`,
      tag: params.tag,
      status: params.status ?? "ACTIVE",
      metrologyRegime: params.metrologyRegime ?? "INDUSTRIAL",
      nextLegalVerificationDate: params.nextLegalVerificationDate ?? null,
      nextCalibrationDate: params.nextCalibrationDate ?? null,
      regulatedInterval: params.regulatedInterval ?? null,
      createdAt: EPOCH,
    })
    .returning();
  if (!row) throw new Error("seedScheduledAsset: asset insert failed");

  return { assetId: row.id, customerId: cust.id, assetTypeId: type.id };
}

/**
 * Pre-seed a `scheduled_notification` row directly (used to assert the sweep's
 * NOT EXISTS dedupe guard suppresses a re-notify, independently of running the
 * sweep twice). `sentAt` defaults to now so it falls inside the guard's recency
 * window.
 */
export async function seedScheduledNotification(params: {
  organizationId: string;
  type: NotificationType;
  entityType: ScheduledNotificationEntityType;
  entityId: number;
  leadTimeDays: number;
  scheduledFor?: Date;
  sentAt?: Date | null;
}): Promise<void> {
  await db.insert(scheduledNotification).values({
    organizationId: params.organizationId,
    type: params.type,
    entityType: params.entityType,
    entityId: params.entityId,
    leadTimeDays: params.leadTimeDays,
    scheduledFor: params.scheduledFor ?? daysFromNow(0),
    sentAt: params.sentAt === undefined ? new Date() : params.sentAt,
  });
}
