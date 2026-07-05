/**
 * user-cascade-soft-delete.int.spec.ts — Real-DB integration tests for the
 * Better Auth `deleteUser` preservation hook (CMP-07 / issue #692).
 *
 * ISO/IEC 17025 §6.2: a user self-deletion must NOT cascade-wipe the regulated
 * competence / training / authorized-signatory records that point at that user.
 * The subject FKs are ON DELETE SET NULL (migration 0083, mirrored in schema.ts)
 * and `preserveRegulatedRecordsOnUserDeletion` (packages/auth) soft-deletes /
 * revokes + writes an identity-snapshot audit row BEFORE the user row is deleted.
 *
 * The harness builds the schema from schema.ts via `drizzle-kit push`, so the
 * SET-NULL FK change drives real behavior here. We exercise the exported hook
 * directly and then delete the user row (what Better Auth's internalAdapter does
 * right after `beforeDelete`), because the integration harness globally mocks the
 * Better Auth create* factories (test/integration/setup.ts) — driving the full
 * /delete-user endpoint through that mock is impractical.
 *
 * Proven properties (oracle):
 *   REQ-CMP-USR-001 [HIGH RISK] competence/training/signatory rows PERSIST after
 *                   user deletion, with user_id NULL (competence+training soft-
 *                   deleted, signatory REVOKED).
 *   REQ-CMP-USR-002 [HIGH RISK] deletion writes audit rows carrying a name/email
 *                   identity snapshot that survive the user's deletion; the
 *                   pre-existing audit rows also survive.
 *   REQ-CMP-USR-003 a user with NO such records deletes with no regression (no
 *                   new audit rows, user row gone).
 *   REQ-CMP-USR-004 R2 keys on surviving training/competence rows are untouched.
 *   REQ-CMP-USR-005 [HIGH RISK] REWORK (verifier-reproduced defect): two users
 *                   in the SAME org sharing the same (org, asset_type) scope
 *                   (e.g. both org-wide signatories, both org-wide competences)
 *                   can BOTH be deleted — the second tombstone (user_id NULL)
 *                   must not collide with the first on the NULLS-NOT-DISTINCT
 *                   composite unique key. Requires the partial unique indexes
 *                   (migration 0083 rework: `WHERE user_id IS NOT NULL`).
 *   REQ-CMP-USR-006 sanity: the composite unique constraint still rejects a
 *                   genuine duplicate ACTIVE (org, user, asset_type) row —
 *                   the partial-index rework did not weaken live-row dedup.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { preserveRegulatedRecordsOnUserDeletion } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  authorizedSignatory,
  authorizedSignatoryAuditLog,
  personnelCompetence,
  personnelCompetenceAuditLog,
  trainingRecord,
  trainingRecordAuditLog,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

/**
 * postgres-js surfaces a duplicate insert as a Drizzle `DrizzleQueryError`
 * wrapper whose OWN `code` is undefined — the real Postgres error code
 * (23505 = unique_violation) lives one level down on `error.cause`. Mirrors
 * the `hasUniqueViolationCode` / `isUniqueConstraintError` pattern in
 * `apps/api/src/services/commercial/reconcile-webhook.ts` (as-free: uses
 * `Reflect.get`, not a type assertion).
 */
function hasCode(value: unknown, code: string): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      Reflect.get(value, "code") === code,
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (hasCode(error, "23505")) return true;
  if (error && typeof error === "object" && "cause" in error) {
    return hasCode(Reflect.get(error, "cause"), "23505");
  }
  return false;
}

const SUBJECT_NAME = "Marina Metrologista";
const SUBJECT_EMAIL = "marina@lab.test";
const COMPETENCE_R2_KEY = "competence/marina-cert.pdf";
const TRAINING_R2_KEY = "training/marina-gum-cert.pdf";

/** Seed a subject user plus one row in each of the 3 regulated tables. */
async function seedSubjectWithRecords(params: {
  orgId: string;
  adminUserId: string;
  subjectUserId: string;
}): Promise<{
  competenceId: number;
  trainingId: number;
  signatoryId: number;
  preExistingCompetenceAuditId: number;
  preExistingTrainingAuditId: number;
  preExistingSignatoryAuditId: number;
}> {
  await db.insert(user).values({
    id: params.subjectUserId,
    name: SUBJECT_NAME,
    email: SUBJECT_EMAIL,
  });

  const [competence] = await db
    .insert(personnelCompetence)
    .values({
      organizationId: params.orgId,
      userId: params.subjectUserId,
      scopeDescription: "Calibração de massa até 10 kg",
      status: "ACTIVE",
      certificateR2Key: COMPETENCE_R2_KEY,
      requestedBy: params.adminUserId,
      createdBy: params.adminUserId,
    })
    .returning({ id: personnelCompetence.id });
  if (!competence) throw new Error("seed competence failed");

  const [training] = await db
    .insert(trainingRecord)
    .values({
      organizationId: params.orgId,
      userId: params.subjectUserId,
      title: "GUM — expressão da incerteza",
      type: "external",
      status: "completed",
      startDate: new Date("2026-02-01T00:00:00.000Z"),
      certificateR2Key: TRAINING_R2_KEY,
      createdBy: params.adminUserId,
    })
    .returning({ id: trainingRecord.id });
  if (!training) throw new Error("seed training failed");

  const [signatory] = await db
    .insert(authorizedSignatory)
    .values({
      organizationId: params.orgId,
      userId: params.subjectUserId,
      authorizedBy: params.adminUserId,
      status: "ACTIVE",
    })
    .returning({ id: authorizedSignatory.id });
  if (!signatory) throw new Error("seed signatory failed");

  // Pre-existing audit rows (the "create"/"grant" trail) that must ALSO survive.
  const [compAudit] = await db
    .insert(personnelCompetenceAuditLog)
    .values({
      competenceId: competence.id,
      action: "create",
      changes: { created: true },
      performedBy: params.adminUserId,
    })
    .returning({ id: personnelCompetenceAuditLog.id });
  const [trainAudit] = await db
    .insert(trainingRecordAuditLog)
    .values({
      trainingRecordId: training.id,
      action: "create",
      changes: { created: true },
      performedBy: params.adminUserId,
    })
    .returning({ id: trainingRecordAuditLog.id });
  const [sigAudit] = await db
    .insert(authorizedSignatoryAuditLog)
    .values({
      signatoryId: signatory.id,
      action: "grant",
      changes: { granted: true },
      performedBy: params.adminUserId,
    })
    .returning({ id: authorizedSignatoryAuditLog.id });
  if (!compAudit || !trainAudit || !sigAudit) {
    throw new Error("seed pre-existing audit rows failed");
  }

  return {
    competenceId: competence.id,
    trainingId: training.id,
    signatoryId: signatory.id,
    preExistingCompetenceAuditId: compAudit.id,
    preExistingTrainingAuditId: trainAudit.id,
    preExistingSignatoryAuditId: sigAudit.id,
  };
}

describe("Better Auth deleteUser — regulated-record preservation (CMP-07 #692)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CMP-USR-001 / REQ-CMP-USR-002 / REQ-CMP-USR-004: subject records survive with user_id NULL, identity-snapshot audit rows are written, R2 keys untouched, user row gone", async () => {
    const { orgId, userId: adminUserId } = await seedOrg({ orgId: "org-cmp" });
    const subjectUserId = "subject-marina";
    const seeded = await seedSubjectWithRecords({
      orgId,
      adminUserId,
      subjectUserId,
    });

    // (1) run the beforeDelete hook, then (2) delete the user row exactly as
    // Better Auth's internalAdapter.deleteUser does right after beforeDelete.
    await preserveRegulatedRecordsOnUserDeletion({
      id: subjectUserId,
      name: SUBJECT_NAME,
      email: SUBJECT_EMAIL,
    });
    await db.delete(user).where(eq(user.id, subjectUserId));

    // --- user row is gone (REQ-001 precondition) ---
    const remainingUser = await db
      .select()
      .from(user)
      .where(eq(user.id, subjectUserId));
    expect(remainingUser).toHaveLength(0);

    // --- REQ-CMP-USR-001: competence survives, soft-deleted, user_id NULL ---
    const [competence] = await db
      .select()
      .from(personnelCompetence)
      .where(eq(personnelCompetence.id, seeded.competenceId));
    expect(competence).toBeDefined();
    expect(competence?.userId).toBeNull();
    expect(competence?.deletedAt).not.toBeNull();
    // REQ-CMP-USR-004: R2 key untouched.
    expect(competence?.certificateR2Key).toBe(COMPETENCE_R2_KEY);

    // --- REQ-CMP-USR-001: training survives, soft-deleted, user_id NULL ---
    const [training] = await db
      .select()
      .from(trainingRecord)
      .where(eq(trainingRecord.id, seeded.trainingId));
    expect(training).toBeDefined();
    expect(training?.userId).toBeNull();
    expect(training?.deletedAt).not.toBeNull();
    // REQ-CMP-USR-004: R2 key untouched.
    expect(training?.certificateR2Key).toBe(TRAINING_R2_KEY);

    // --- REQ-CMP-USR-001: signatory survives, REVOKED, user_id NULL ---
    const [signatory] = await db
      .select()
      .from(authorizedSignatory)
      .where(eq(authorizedSignatory.id, seeded.signatoryId));
    expect(signatory).toBeDefined();
    expect(signatory?.userId).toBeNull();
    expect(signatory?.status).toBe("REVOKED");
    expect(signatory?.revokedAt).not.toBeNull();

    // --- REQ-CMP-USR-002: new audit rows identify the PERSON via snapshot ---
    const competenceAudits = await db
      .select()
      .from(personnelCompetenceAuditLog)
      .where(eq(personnelCompetenceAuditLog.competenceId, seeded.competenceId));
    // pre-existing "create" + new "delete"
    expect(competenceAudits).toHaveLength(2);
    // pre-existing row survived
    expect(
      competenceAudits.some((r) => r.id === seeded.preExistingCompetenceAuditId),
    ).toBe(true);
    const compDeleteAudit = competenceAudits.find((r) => r.action === "delete");
    expect(compDeleteAudit).toBeDefined();
    expect(compDeleteAudit?.performedBy).toBe(subjectUserId);
    expect(compDeleteAudit?.reason).toBe("Usuário excluído");
    expect(JSON.stringify(compDeleteAudit?.changes)).toContain(SUBJECT_NAME);
    expect(JSON.stringify(compDeleteAudit?.changes)).toContain(SUBJECT_EMAIL);

    const trainingAudits = await db
      .select()
      .from(trainingRecordAuditLog)
      .where(eq(trainingRecordAuditLog.trainingRecordId, seeded.trainingId));
    expect(trainingAudits).toHaveLength(2);
    expect(
      trainingAudits.some((r) => r.id === seeded.preExistingTrainingAuditId),
    ).toBe(true);
    const trainDeleteAudit = trainingAudits.find((r) => r.action === "delete");
    expect(trainDeleteAudit).toBeDefined();
    expect(trainDeleteAudit?.performedBy).toBe(subjectUserId);
    expect(JSON.stringify(trainDeleteAudit?.changes)).toContain(SUBJECT_NAME);
    expect(JSON.stringify(trainDeleteAudit?.changes)).toContain(SUBJECT_EMAIL);

    const signatoryAudits = await db
      .select()
      .from(authorizedSignatoryAuditLog)
      .where(eq(authorizedSignatoryAuditLog.signatoryId, seeded.signatoryId));
    expect(signatoryAudits).toHaveLength(2);
    expect(
      signatoryAudits.some((r) => r.id === seeded.preExistingSignatoryAuditId),
    ).toBe(true);
    const sigRevokeAudit = signatoryAudits.find((r) => r.action === "revoke");
    expect(sigRevokeAudit).toBeDefined();
    expect(sigRevokeAudit?.performedBy).toBe(subjectUserId);
    expect(sigRevokeAudit?.reason).toBe("Usuário excluído");
    expect(JSON.stringify(sigRevokeAudit?.changes)).toContain(SUBJECT_NAME);
    expect(JSON.stringify(sigRevokeAudit?.changes)).toContain(SUBJECT_EMAIL);
  });

  it("REQ-CMP-USR-003: a user with NO regulated records deletes with no regression (no new audit rows)", async () => {
    const { userId: adminUserId } = await seedOrg({ orgId: "org-plain" });
    const subjectUserId = "subject-no-records";
    await db.insert(user).values({
      id: subjectUserId,
      name: "Sem Registros",
      email: "sem-registros@lab.test",
    });

    const auditCountBefore =
      (await db.select().from(personnelCompetenceAuditLog)).length +
      (await db.select().from(trainingRecordAuditLog)).length +
      (await db.select().from(authorizedSignatoryAuditLog)).length;

    await preserveRegulatedRecordsOnUserDeletion({
      id: subjectUserId,
      name: "Sem Registros",
      email: "sem-registros@lab.test",
    });
    await db.delete(user).where(eq(user.id, subjectUserId));

    const auditCountAfter =
      (await db.select().from(personnelCompetenceAuditLog)).length +
      (await db.select().from(trainingRecordAuditLog)).length +
      (await db.select().from(authorizedSignatoryAuditLog)).length;
    expect(auditCountAfter).toBe(auditCountBefore);

    const remainingUser = await db
      .select()
      .from(user)
      .where(eq(user.id, subjectUserId));
    expect(remainingUser).toHaveLength(0);

    // admin (creator) is untouched.
    const remainingAdmin = await db
      .select()
      .from(user)
      .where(eq(user.id, adminUserId));
    expect(remainingAdmin).toHaveLength(1);
  });

  it("REQ-CMP-USR-005 [HIGH RISK]: deleting a SECOND user sharing the same org-wide scope must not collide on the tombstoned unique key", async () => {
    const { orgId, userId: adminUserId } = await seedOrg({ orgId: "org-multi" });
    const userA = "subject-user-a";
    const userB = "subject-user-b";

    await db
      .insert(user)
      .values([
        { id: userA, name: "Usuário A", email: "user-a@lab.test" },
        { id: userB, name: "Usuário B", email: "user-b@lab.test" },
      ]);

    // Both users: an org-wide (asset_type_id NULL) competence AND an org-wide
    // signatory — the exact "two org-wide signatories" shape the verifier
    // flagged as the NORM, colliding at (org, NULL, NULL) once tombstoned.
    const [competenceA] = await db
      .insert(personnelCompetence)
      .values({
        organizationId: orgId,
        userId: userA,
        scopeDescription: "Escopo geral",
        status: "ACTIVE",
        requestedBy: adminUserId,
        createdBy: adminUserId,
      })
      .returning({ id: personnelCompetence.id });
    const [competenceB] = await db
      .insert(personnelCompetence)
      .values({
        organizationId: orgId,
        userId: userB,
        scopeDescription: "Escopo geral",
        status: "ACTIVE",
        requestedBy: adminUserId,
        createdBy: adminUserId,
      })
      .returning({ id: personnelCompetence.id });
    const [signatoryA] = await db
      .insert(authorizedSignatory)
      .values({
        organizationId: orgId,
        userId: userA,
        authorizedBy: adminUserId,
        status: "ACTIVE",
      })
      .returning({ id: authorizedSignatory.id });
    const [signatoryB] = await db
      .insert(authorizedSignatory)
      .values({
        organizationId: orgId,
        userId: userB,
        authorizedBy: adminUserId,
        status: "ACTIVE",
      })
      .returning({ id: authorizedSignatory.id });
    if (!competenceA || !competenceB || !signatoryA || !signatoryB) {
      throw new Error("seed failed");
    }

    // Delete user A first — tombstones competenceA/signatoryA (user_id NULL).
    await preserveRegulatedRecordsOnUserDeletion({
      id: userA,
      name: "Usuário A",
      email: "user-a@lab.test",
    });
    await db.delete(user).where(eq(user.id, userA));

    // Delete user B SECOND — must ALSO succeed. Pre-fix (non-partial NULLS NOT
    // DISTINCT index) this throws 23505: the UPDATE ... SET user_id = NULL
    // inside the hook collides with user A's already-NULL tombstone key
    // (org, NULL, NULL), aborting the whole transaction.
    await expect(
      (async () => {
        await preserveRegulatedRecordsOnUserDeletion({
          id: userB,
          name: "Usuário B",
          email: "user-b@lab.test",
        });
        await db.delete(user).where(eq(user.id, userB));
      })(),
    ).resolves.toBeUndefined();

    // Both users actually gone.
    const remainingUsers = await db
      .select()
      .from(user)
      .where(eq(user.id, userA));
    expect(remainingUsers).toHaveLength(0);
    const remainingUsersB = await db
      .select()
      .from(user)
      .where(eq(user.id, userB));
    expect(remainingUsersB).toHaveLength(0);

    // Both tombstone sets present, user_id NULL, deletedAt/revokedAt set.
    const [compA] = await db
      .select()
      .from(personnelCompetence)
      .where(eq(personnelCompetence.id, competenceA.id));
    const [compB] = await db
      .select()
      .from(personnelCompetence)
      .where(eq(personnelCompetence.id, competenceB.id));
    expect(compA?.userId).toBeNull();
    expect(compA?.deletedAt).not.toBeNull();
    expect(compB?.userId).toBeNull();
    expect(compB?.deletedAt).not.toBeNull();

    const [sigA] = await db
      .select()
      .from(authorizedSignatory)
      .where(eq(authorizedSignatory.id, signatoryA.id));
    const [sigB] = await db
      .select()
      .from(authorizedSignatory)
      .where(eq(authorizedSignatory.id, signatoryB.id));
    expect(sigA?.userId).toBeNull();
    expect(sigA?.status).toBe("REVOKED");
    expect(sigB?.userId).toBeNull();
    expect(sigB?.status).toBe("REVOKED");

    // Audit rows for BOTH users present (identity snapshot each).
    const compAudits = await db.select().from(personnelCompetenceAuditLog);
    expect(compAudits.some((r) => r.performedBy === userA)).toBe(true);
    expect(compAudits.some((r) => r.performedBy === userB)).toBe(true);
    const sigAudits = await db.select().from(authorizedSignatoryAuditLog);
    expect(sigAudits.some((r) => r.performedBy === userA)).toBe(true);
    expect(sigAudits.some((r) => r.performedBy === userB)).toBe(true);
  });

  it("REQ-CMP-USR-006: a genuine duplicate ACTIVE (org, user, asset_type) row is still rejected (23505)", async () => {
    const { orgId, userId: adminUserId } = await seedOrg({ orgId: "org-dupe" });
    const subjectUserId = "subject-dupe-check";
    await db.insert(user).values({
      id: subjectUserId,
      name: "Usuário Duplicado",
      email: "dupe@lab.test",
    });

    await db.insert(authorizedSignatory).values({
      organizationId: orgId,
      userId: subjectUserId,
      authorizedBy: adminUserId,
      status: "ACTIVE",
    });

    let signatoryError: unknown;
    try {
      await db.insert(authorizedSignatory).values({
        organizationId: orgId,
        userId: subjectUserId,
        authorizedBy: adminUserId,
        status: "ACTIVE",
      });
    } catch (error) {
      signatoryError = error;
    }
    expect(isUniqueViolation(signatoryError)).toBe(true);

    await db.insert(personnelCompetence).values({
      organizationId: orgId,
      userId: subjectUserId,
      scopeDescription: "Escopo geral",
      status: "ACTIVE",
      requestedBy: adminUserId,
      createdBy: adminUserId,
    });

    let competenceError: unknown;
    try {
      await db.insert(personnelCompetence).values({
        organizationId: orgId,
        userId: subjectUserId,
        scopeDescription: "Escopo geral (duplicado)",
        status: "ACTIVE",
        requestedBy: adminUserId,
        createdBy: adminUserId,
      });
    } catch (error) {
      competenceError = error;
    }
    expect(isUniqueViolation(competenceError)).toBe(true);
  });
});
