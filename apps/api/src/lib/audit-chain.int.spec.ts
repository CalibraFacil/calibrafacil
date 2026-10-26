/**
 * audit-chain.int.spec.ts: real-Postgres proof of the audit-trail hash chain
 * (migration 0131, roadmap 2 B1):
 *
 *   REQ-CHAIN-4  inserting audit rows (as the owner and as calibra_app) builds a correct
 *                per-organization chain, and an insert cannot choose its own link
 *   REQ-CHAIN-5  concurrent writers of one organization never fork the chain
 *   REQ-CHAIN-6  a tampered row, a deleted link and a bypassed insert are found, pointing at
 *                the right row; a deleted tail is found through the recorded checkpoint
 *   REQ-CHAIN-7  the verifier reports once, records a checkpoint, notifies the admins and fails
 *                the cron run while a chain is broken
 *   REQ-CHAIN-8  the backfill chains existing rows in id order (and only the owner may run it)
 *
 * The owner path (the harness `db`, a superuser) plays the attacker for the tamper cases: it
 * is the only role that CAN rewrite an audit row (the application role has no UPDATE/DELETE
 * on the table since migration 0130), and it is exactly who the chain is meant to expose.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, systemDb } from "@calibra-facil/db";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import { createRoleDatabase } from "@calibra-facil/db/role-connection";
import {
  jobAuditLog,
  notification,
  organizationEventLog,
  platformEventLog,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { openAppRoleDb, sqlStateOf } from "../../test/integration/rls";
import { seedOrg } from "../../test/integration/seed";
import {
  AuditChainBrokenError,
  CHAIN_BROKEN_ORGANIZATION_ACTION,
  CHAIN_BROKEN_PLATFORM_ACTION,
  CHAIN_CHECKPOINT_ACTION,
  runAuditChainVerification,
  verifyAuditChains,
} from "./audit-chain";

type Fixture = Awaited<ReturnType<typeof seedOrg>>;

/** Inserts `count` audit rows for the organization as the owner, in order. */
async function insertRows(
  fixture: Fixture,
  count: number,
  jobId = 1,
): Promise<number[]> {
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const [row] = await db
      .insert(jobAuditLog)
      .values({
        organizationId: fixture.orgId,
        jobId,
        action: index === 0 ? "create" : "update",
        changes: { n: { old: index, new: index + 1 } },
        performedBy: fixture.userId,
        reason: `row ${index + 1}`,
      })
      .returning({ id: jobAuditLog.id });
    if (!row) throw new Error("insert failed");
    ids.push(row.id);
  }
  return ids;
}

type Link = {
  id: number;
  chainSeq: number | null;
  prev: string | null;
  hash: string | null;
};

async function linksOf(orgId: string): Promise<Link[]> {
  const rows = await db.execute<{
    id: number;
    chain_seq: string | null;
    prev: string | null;
    hash: string | null;
  }>(sql`
    select id, chain_seq::text as chain_seq,
           encode(prev_hash, 'hex') as prev, encode(row_hash, 'hex') as hash
      from job_audit_log where organization_id = ${orgId} order by id`);
  return Array.from(rows).map((row) => ({
    id: row.id,
    chainSeq: row.chain_seq === null ? null : Number(row.chain_seq),
    prev: row.prev,
    hash: row.hash,
  }));
}

type Verdict = {
  row_id: number | null;
  chain_seq: string | null;
  kind: string;
};

/** The SQL verifier's first break for an organization, null when intact. */
async function firstBreak(orgId: string): Promise<Verdict | null> {
  const rows = await db.execute<Verdict>(sql`
    select out_row_id as row_id, out_chain_seq::text as chain_seq, out_kind as kind
      from calibra_audit_chain_verify('job_audit_log', ${orgId})`);
  return Array.from(rows)[0] ?? null;
}

/** Runs `work` as the table owner with the audit-rewrite hatch open (what an attacker with the owner credentials could do). */
async function asOwnerRewriting<T>(
  work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
    );
    return work(tx);
  });
}

describe("audit hash chain (migration 0131)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CHAIN-4: rows get consecutive positions, each linked to the hash of the previous one, per organization", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const b = await seedOrg({ orgId: "org-b", userId: "user-b" });
    await insertRows(a, 3);
    await insertRows(b, 2);
    await insertRows(a, 1, 2);

    const linksA = await linksOf(a.orgId);
    const linksB = await linksOf(b.orgId);
    expect(linksA.map((link) => link.chainSeq)).toEqual([1, 2, 3, 4]);
    expect(linksB.map((link) => link.chainSeq)).toEqual([1, 2]);
    expect(linksA[0]?.prev).toBeNull();
    expect(linksB[0]?.prev).toBeNull();
    for (const links of [linksA, linksB]) {
      for (const [index, link] of links.entries()) {
        expect(link.hash).toMatch(/^[0-9a-f]{64}$/);
        if (index > 0) expect(link.prev).toBe(links[index - 1]?.hash);
      }
    }
    // Two organizations never share a chain.
    expect(linksA[0]?.hash).not.toBe(linksB[0]?.hash);
    expect(await firstBreak(a.orgId)).toBeNull();
    expect(await firstBreak(b.orgId)).toBeNull();
  });

  it("REQ-CHAIN-4: an insert cannot choose its own place: whatever chain values it carries are overwritten", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 1);
    await db.execute(sql`
      insert into job_audit_log
        (organization_id, job_id, action, performed_by, chain_seq, prev_hash, row_hash)
      values (${a.orgId}, 1, 'update', ${a.userId}, 99, '\\xdeadbeef', '\\xfeedface')`);

    const links = await linksOf(a.orgId);
    expect(links.map((link) => link.chainSeq)).toEqual([1, 2]);
    expect(links[1]?.prev).toBe(links[0]?.hash);
    expect(links[1]?.hash).not.toBe("feedface");
    expect(await firstBreak(a.orgId)).toBeNull();
  });

  it("REQ-CHAIN-4: the application's own writer (appendJobEvent as calibra_app, in an organization-bound transaction) extends the same chain", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 2);
    const app = openAppRoleDb().db;
    await app.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.organization_id', ${a.orgId}, true)`,
      );
      await appendJobEvent(tx, {
        organizationId: a.orgId,
        jobId: 1,
        action: "update",
        actor: { kind: "user", userId: a.userId },
        changes: { technicianId: { old: null, new: "someone" } },
      });
    });
    const links = await linksOf(a.orgId);
    expect(links.map((link) => link.chainSeq)).toEqual([1, 2, 3]);
    expect(links[2]?.prev).toBe(links[1]?.hash);
    expect(await firstBreak(a.orgId)).toBeNull();
  });

  it("REQ-CHAIN-5 [HIGH RISK]: concurrent transactions of one organization never fork the chain", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const b = await seedOrg({ orgId: "org-b", userId: "user-b" });
    const url = process.env.DATABASE_URL ?? "";
    const pool = createRoleDatabase(url, { role: "calibra_app", max: 12 });
    try {
      const writers = 12;
      const perWriter = 4;
      await Promise.all(
        Array.from({ length: writers }, (_, writer) =>
          pool.db.transaction(async (tx) => {
            // Half of the writers write for organization A, the other half for B.
            const target = writer % 2 === 0 ? a : b;
            await tx.execute(
              sql`select set_config('calibra.organization_id', ${target.orgId}, true)`,
            );
            for (let n = 0; n < perWriter; n += 1) {
              await appendJobEvent(tx, {
                organizationId: target.orgId,
                jobId: writer + 1,
                action: "update",
                actor: { kind: "user", userId: target.userId },
                changes: { writer: { old: n, new: n + 1 } },
              });
              // Widen the race window: the lock is held to COMMIT.
              await tx.execute(sql`select pg_sleep(0.01)`);
            }
          }),
        ),
      );
    } finally {
      await pool.close();
    }

    for (const target of [a, b]) {
      const links = await linksOf(target.orgId);
      expect(links).toHaveLength(6 * 4);
      // Exactly 1..N, no gap and no duplicate, and every link names its predecessor.
      const bySeq = [...links].sort(
        (left, right) => (left.chainSeq ?? 0) - (right.chainSeq ?? 0),
      );
      expect(bySeq.map((link) => link.chainSeq)).toEqual(
        Array.from({ length: 24 }, (_, index) => index + 1),
      );
      for (const [index, link] of bySeq.entries()) {
        expect(link.prev).toBe(index === 0 ? null : bySeq[index - 1]?.hash);
      }
      expect(await firstBreak(target.orgId)).toBeNull();
    }
  });

  it("REQ-CHAIN-5: even a transaction that ignores the lock cannot fork: the unique index refuses a duplicate position", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 2);
    // Disable the trigger as the owner and try to write position 2 again.
    await db.execute(
      sql`alter table job_audit_log disable trigger job_audit_log_hash_chain`,
    );
    try {
      const state = await sqlStateOf(
        db.execute(sql`
          insert into job_audit_log
            (organization_id, job_id, action, performed_by, chain_seq, prev_hash, row_hash)
          values (${a.orgId}, 1, 'update', ${a.userId}, 2, '\\x00', '\\x00')`),
      );
      expect(state).toBe("23505");
    } finally {
      await db.execute(
        sql`alter table job_audit_log enable trigger job_audit_log_hash_chain`,
      );
    }
  });

  it("REQ-CHAIN-6 [HIGH RISK]: an edited row is found, naming that row", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const ids = await insertRows(a, 5);
    const victim = ids[2];
    if (victim === undefined) throw new Error("no row");

    await asOwnerRewriting((tx) =>
      tx
        .update(jobAuditLog)
        .set({ reason: "rewritten after the fact" })
        .where(eq(jobAuditLog.id, victim)),
    );

    expect(await firstBreak(a.orgId)).toEqual({
      row_id: victim,
      chain_seq: "3",
      kind: "row_hash_mismatch",
    });
  });

  it("REQ-CHAIN-6: each hashed column is covered (changes, actor, time, job, action, ip, organization)", async () => {
    const edits: Array<[string, ReturnType<typeof sql>]> = [
      ["changes", sql`changes = '{"n":{"old":0,"new":999}}'::jsonb`],
      ["performed_by", sql`performed_by = 'user-b'`],
      ["performed_at", sql`performed_at = performed_at + interval '1 second'`],
      ["job_id", sql`job_id = job_id + 1`],
      ["action", sql`action = 'approve'`],
      ["ip_address", sql`ip_address = '10.0.0.1'`],
      ["organization_id", sql`organization_id = 'org-b'`],
    ];
    for (const [column, assignment] of edits) {
      await truncateAll();
      const fixture = await seedOrg({ orgId: "org-a", userId: "user-a" });
      await seedOrg({ orgId: "org-b", userId: "user-b" });
      const ids = await insertRows(fixture, 3);
      const victim = ids[1];
      await asOwnerRewriting((tx) =>
        tx.execute(
          sql`update job_audit_log set ${assignment} where id = ${victim}`,
        ),
      );
      // The edit that moves the row to another organization leaves a hole in A's chain.
      const found = await firstBreak(fixture.orgId);
      expect(found, column).not.toBeNull();
      if (column !== "organization_id") {
        expect(found?.row_id, column).toBe(victim);
        expect(found?.kind, column).toBe("row_hash_mismatch");
      }
    }
  });

  it("REQ-CHAIN-6: a link deleted from the middle is found as a gap, at the row after it", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const ids = await insertRows(a, 5);
    const [, , deleted, after] = ids;
    if (deleted === undefined || after === undefined) throw new Error("no row");

    await asOwnerRewriting((tx) =>
      tx.delete(jobAuditLog).where(eq(jobAuditLog.id, deleted)),
    );

    expect(await firstBreak(a.orgId)).toEqual({
      row_id: after,
      chain_seq: "4",
      kind: "sequence_gap",
    });
  });

  it("REQ-CHAIN-6: a deleted head is found as a gap too (the chain no longer starts at 1)", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const ids = await insertRows(a, 3);
    const [first, second] = ids;
    if (first === undefined || second === undefined) throw new Error("no row");
    await asOwnerRewriting((tx) =>
      tx.delete(jobAuditLog).where(eq(jobAuditLog.id, first)),
    );
    expect(await firstBreak(a.orgId)).toEqual({
      row_id: second,
      chain_seq: "2",
      kind: "sequence_gap",
    });
  });

  it("REQ-CHAIN-6: a row written with the trigger bypassed is found as unchained", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 2);
    await db.execute(
      sql`alter table job_audit_log disable trigger job_audit_log_hash_chain`,
    );
    let smuggled: number | undefined;
    try {
      const rows = await db.execute<{ id: number }>(sql`
        insert into job_audit_log (organization_id, job_id, action, performed_by)
        values (${a.orgId}, 1, 'update', ${a.userId}) returning id`);
      smuggled = Array.from(rows)[0]?.id;
    } finally {
      await db.execute(
        sql`alter table job_audit_log enable trigger job_audit_log_hash_chain`,
      );
    }
    expect(await firstBreak(a.orgId)).toEqual({
      row_id: smuggled,
      chain_seq: null,
      kind: "unchained_row",
    });
  });

  it("REQ-CHAIN-7: the verifier records a checkpoint per intact head, only when the head moved", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const b = await seedOrg({ orgId: "org-b", userId: "user-b" });
    await insertRows(a, 3);
    await insertRows(b, 1);

    const first = await verifyAuditChains({ record: true });
    expect(first).toMatchObject({
      chains: 2,
      links: 4,
      intact: 2,
      checkpoints: 2,
    });
    expect(first.broken).toEqual([]);

    const second = await verifyAuditChains({ record: true });
    expect(second).toMatchObject({ intact: 2, checkpoints: 0 });

    await insertRows(a, 1);
    const third = await verifyAuditChains({ record: true });
    expect(third).toMatchObject({ intact: 2, checkpoints: 1 });

    const checkpoints = await systemDb
      .select({ details: platformEventLog.details })
      .from(platformEventLog)
      .where(eq(platformEventLog.action, CHAIN_CHECKPOINT_ACTION))
      .orderBy(asc(platformEventLog.id));
    expect(checkpoints.map((event) => event.details?.headSeq)).toEqual([
      3, 1, 4,
    ]);

    // The on-demand run records nothing.
    await insertRows(a, 1);
    const readOnly = await verifyAuditChains({ record: false });
    expect(readOnly).toMatchObject({ intact: 2, checkpoints: 0 });
    expect(
      await systemDb
        .select({ id: platformEventLog.id })
        .from(platformEventLog)
        .where(eq(platformEventLog.action, CHAIN_CHECKPOINT_ACTION)),
    ).toHaveLength(3);
  });

  it("REQ-CHAIN-7 [HIGH RISK]: a tampered row is announced once (platform event, the laboratory's event log, a notification to its admin), the cron run fails, and a rerun stays quiet", async () => {
    const a = await seedOrg({
      orgId: "org-a",
      userId: "user-a",
      role: "admin",
    });
    const b = await seedOrg({
      orgId: "org-b",
      userId: "user-b",
      role: "admin",
    });
    const ids = await insertRows(a, 4);
    await insertRows(b, 2);
    await verifyAuditChains({ record: true });

    const victim = ids[1];
    if (victim === undefined) throw new Error("no row");
    await asOwnerRewriting((tx) =>
      tx
        .update(jobAuditLog)
        .set({ reason: "tampered" })
        .where(eq(jobAuditLog.id, victim)),
    );

    const first = await verifyAuditChains({ record: true });
    expect(first.intact).toBe(1);
    expect(first.broken).toHaveLength(1);
    expect(first.broken[0]).toMatchObject({
      table: "job_audit_log",
      organizationId: a.orgId,
      kind: "row_hash_mismatch",
      chainSeq: 2,
      rowId: victim,
    });
    expect(first.announced).toHaveLength(1);
    expect(first.failures).toEqual([]);

    const platform = await systemDb
      .select({ details: platformEventLog.details })
      .from(platformEventLog)
      .where(eq(platformEventLog.action, CHAIN_BROKEN_PLATFORM_ACTION));
    expect(platform).toHaveLength(1);
    expect(platform[0]?.details).toMatchObject({
      kind: "row_hash_mismatch",
      chainSeq: 2,
      rowId: victim,
    });

    const events = await db
      .select({ details: organizationEventLog.details })
      .from(organizationEventLog)
      .where(
        and(
          eq(organizationEventLog.organizationId, a.orgId),
          eq(organizationEventLog.action, CHAIN_BROKEN_ORGANIZATION_ACTION),
        ),
      );
    expect(events).toHaveLength(1);
    // The other laboratory is untouched.
    expect(
      await db
        .select({ id: organizationEventLog.id })
        .from(organizationEventLog)
        .where(eq(organizationEventLog.organizationId, b.orgId)),
    ).toHaveLength(0);

    const notified = await db
      .select({
        recipient: notification.recipientUserId,
        type: notification.type,
        priority: notification.priority,
      })
      .from(notification)
      .where(eq(notification.type, "AUDIT_CHAIN_BROKEN"));
    expect(notified).toEqual([
      { recipient: a.userId, type: "AUDIT_CHAIN_BROKEN", priority: "HIGH" },
    ]);

    // The cron reports the break by failing...
    const failure = await runAuditChainVerification().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AuditChainBrokenError);
    // ...but does not announce it again.
    const rerun = await verifyAuditChains({ record: true });
    expect(rerun.broken).toHaveLength(1);
    expect(rerun.announced).toEqual([]);
    expect(
      await systemDb
        .select({ id: platformEventLog.id })
        .from(platformEventLog)
        .where(eq(platformEventLog.action, CHAIN_BROKEN_PLATFORM_ACTION)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: notification.id })
        .from(notification)
        .where(eq(notification.type, "AUDIT_CHAIN_BROKEN")),
    ).toHaveLength(1);
  });

  it("REQ-CHAIN-6: a deleted tail, which the chain alone cannot show, is found through the checkpoint of the previous run", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const ids = await insertRows(a, 4);
    expect((await verifyAuditChains({ record: true })).intact).toBe(1);

    const [, , third, fourth] = ids;
    if (third === undefined || fourth === undefined) throw new Error("no row");
    await asOwnerRewriting((tx) =>
      tx.delete(jobAuditLog).where(eq(jobAuditLog.id, fourth)),
    );
    // The remaining chain is intact on its own...
    expect(await firstBreak(a.orgId)).toBeNull();
    // ...the checkpoint says rows were verified that are gone.
    const report = await verifyAuditChains({ record: false });
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]).toMatchObject({
      kind: "checkpoint_missing",
      chainSeq: 4,
    });

    // A whole organization's rows deleted is found too.
    await asOwnerRewriting((tx) =>
      tx.delete(jobAuditLog).where(eq(jobAuditLog.organizationId, a.orgId)),
    );
    const emptied = await verifyAuditChains({ record: false });
    expect(emptied.broken[0]).toMatchObject({
      organizationId: a.orgId,
      kind: "checkpoint_missing",
    });
  });

  it("REQ-CHAIN-6: a replaced row at the checkpoint position is found (the chain was recomputed after it)", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 3);
    await verifyAuditChains({ record: true });

    // An owner who rewrites a row AND recomputes the chain from it leaves a chain that is
    // internally consistent; only the recorded head betrays it.
    await asOwnerRewriting((tx) =>
      tx
        .update(jobAuditLog)
        .set({ reason: "rewritten" })
        .where(and(eq(jobAuditLog.organizationId, a.orgId))),
    );
    await db.execute(
      sql`select calibra_audit_chain_backfill('job_audit_log', ${a.orgId}, true)`,
    );
    expect(await firstBreak(a.orgId)).toBeNull();
    const report = await verifyAuditChains({ record: false });
    expect(report.broken[0]).toMatchObject({
      kind: "checkpoint_mismatch",
      chainSeq: 3,
    });
  });

  it("REQ-CHAIN-8: the backfill chains rows that predate the chain, per organization, in id order, and is idempotent", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    const b = await seedOrg({ orgId: "org-b", userId: "user-b" });
    const idsA = await insertRows(a, 3);
    const idsB = await insertRows(b, 2);
    const reference = await linksOf(a.orgId);

    // Simulate the table as it was before the migration: rows without a link.
    await asOwnerRewriting((tx) =>
      tx.execute(
        sql`update job_audit_log set chain_seq = null, prev_hash = null, row_hash = null`,
      ),
    );
    expect((await linksOf(a.orgId)).every((link) => link.hash === null)).toBe(
      true,
    );
    expect((await firstBreak(a.orgId))?.kind).toBe("unchained_row");

    const written = await db.execute<{ n: string }>(
      sql`select calibra_audit_chain_backfill('job_audit_log')::text as n`,
    );
    expect(Number(Array.from(written)[0]?.n)).toBe(5);

    const linksA = await linksOf(a.orgId);
    expect(linksA.map((link) => link.id)).toEqual(idsA);
    expect(linksA.map((link) => link.chainSeq)).toEqual([1, 2, 3]);
    expect((await linksOf(b.orgId)).map((link) => link.id)).toEqual(idsB);
    expect(await firstBreak(a.orgId)).toBeNull();
    expect(await firstBreak(b.orgId)).toBeNull();
    // The backfill computes what the trigger computed for the same rows.
    expect(linksA.map((link) => link.hash)).toEqual(
      reference.map((link) => link.hash),
    );

    const again = await db.execute<{ n: string }>(
      sql`select calibra_audit_chain_backfill('job_audit_log')::text as n`,
    );
    expect(Number(Array.from(again)[0]?.n)).toBe(0);
    expect((await linksOf(a.orgId)).map((link) => link.hash)).toEqual(
      reference.map((link) => link.hash),
    );

    // New rows continue the backfilled chain.
    await insertRows(a, 1);
    expect((await linksOf(a.orgId)).map((link) => link.chainSeq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(await firstBreak(a.orgId)).toBeNull();
  });

  it("REQ-CHAIN-8: the backfill and the rebuild refuse the application role, and the history hatch stays closed to it", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 2);
    const app = openAppRoleDb().db;
    const state = await sqlStateOf(
      app.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('calibra.organization_id', ${a.orgId}, true)`,
        );
        await tx.execute(
          sql`select calibra_audit_chain_backfill('job_audit_log', ${a.orgId}, true)`,
        );
      }),
    );
    expect(state).toBe("42501");
    expect(await firstBreak(a.orgId)).toBeNull();
    expect((await linksOf(a.orgId)).map((link) => link.chainSeq)).toEqual([
      1, 2,
    ]);
  });

  it("REQ-CHAIN-8: a row without organization (a legacy orphan) is left unchained and does not break anything", async () => {
    const a = await seedOrg({ orgId: "org-a", userId: "user-a" });
    await insertRows(a, 1);
    // The NOT VALID check refuses new orphans: drop it for the duration, like a legacy row.
    await db.execute(
      sql`alter table job_audit_log drop constraint job_audit_log_organization_id_required`,
    );
    try {
      await db.execute(sql`
        insert into job_audit_log (organization_id, job_id, action, performed_by)
        values (null, 7, 'orphan', ${a.userId})`);
      const rows = await db.execute<{ chain_seq: string | null }>(
        sql`select chain_seq::text from job_audit_log where organization_id is null`,
      );
      expect(Array.from(rows)[0]?.chain_seq).toBeNull();
      expect(await firstBreak(a.orgId)).toBeNull();
    } finally {
      await asOwnerRewriting((tx) =>
        tx.execute(
          sql`delete from job_audit_log where organization_id is null`,
        ),
      );
      await db.execute(sql`
        alter table job_audit_log add constraint job_audit_log_organization_id_required
          check (organization_id is not null) not valid`);
    }
  });
});
