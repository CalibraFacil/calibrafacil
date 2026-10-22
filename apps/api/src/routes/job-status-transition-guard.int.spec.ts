/**
 * job-status-transition-guard.int.spec.ts — Real-Postgres proof that the
 * calibration_job status machine is enforced by the database too, not only by
 * the app writers that read packages/schemas/src/job-transitions.ts
 * (migration 0119):
 *
 *   REQ-TRX-1 [HIGH RISK]  an UPDATE of calibration_job.status that is not a move
 *                          of JOB_TRANSITIONS (and not a no-op) raises
 *                          `calibra: illegal job transition A -> B` (SQLSTATE CF001)
 *   REQ-TRX-2              an INSERT is accepted only in the status `create` lands in
 *   REQ-TRX-4              `SET LOCAL calibra.allow_status_repair = 'on'` (or the
 *                          seed hatch) lifts the guard for one transaction only
 *
 * Every pair is exercised through raw SQL: the point is a writer that does NOT
 * go through the app modules. The harness builds the schema from schema.ts and
 * applies sql/schema-extras.sql, so this also proves the trigger is in a
 * freshly built database.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { JobStatusSchema, JOB_TRANSITIONS } from "@calibra-facil/schemas";
import type { JobStatus } from "@calibra-facil/schemas";
import { sql } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";

const STATUSES = JobStatusSchema.options;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PgFailure = { code: string | null; message: string };

/** Runs a write and returns the Postgres error it raised (walking drizzle's wrapper). */
async function failureOf(run: () => PromiseLike<unknown>): Promise<PgFailure> {
  try {
    await run();
  } catch (error) {
    let current: unknown = error;
    let last: PgFailure | null = null;
    for (let depth = 0; depth < 5 && isRecord(current); depth += 1) {
      const code = typeof current.code === "string" ? current.code : null;
      const message =
        typeof current.message === "string" ? current.message : "";
      if (code !== null) last = { code, message };
      current = current.cause;
    }
    if (last) return last;
    throw error;
  }
  throw new Error("expected the statement to be rejected by Postgres");
}

const LEGAL = new Set<string>();
for (const { from, to } of JOB_TRANSITIONS) {
  if (from !== null && from !== to) LEGAL.add(`${from}>${to}`);
}

type Fixture = {
  jobId: number;
  otherJobId: number;
  orgId: string;
  unitId: number;
  userId: string;
};

async function seedFixture(): Promise<Fixture> {
  const a = await seedOrg({ orgId: "org-trx-a", userId: "user-trx-a" });
  const b = await seedOrg({ orgId: "org-trx-b", userId: "user-trx-b" });
  const jobA = await seedJobForOrg({
    orgId: a.orgId,
    unitId: a.unitId,
    createdBy: a.userId,
  });
  const jobB = await seedJobForOrg({
    orgId: b.orgId,
    unitId: b.unitId,
    createdBy: b.userId,
  });
  return {
    jobId: jobA.jobId,
    otherJobId: jobB.jobId,
    orgId: a.orgId,
    unitId: a.unitId,
    userId: a.userId,
  };
}

async function statusOf(id: number): Promise<string | undefined> {
  const rows = await db.execute<{ status: string }>(
    sql`select status from calibration_job where id = ${id}`,
  );
  return Array.from(rows)[0]?.status;
}

/**
 * Puts a job in `status` the way an audited repair does: transaction-local
 * hatches. Both are needed to start from APPROVED / SUPERSEDED, whose frozen
 * content is guarded separately by calibration_job_immutable_guard (0115).
 */
async function forceStatus(id: number, status: JobStatus): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
    await tx.execute(sql`set local calibra.allow_audit_rewrite = 'on'`);
    await tx.execute(sql`
      update calibration_job
         set status = ${status}, superseded_by_id = null, superseded_at = null
       where id = ${id}`);
  });
}

/** The raw statement a stray script would run. APPROVED -> SUPERSEDED carries its amendment link. */
function rawMove(fixture: Fixture, from: JobStatus, to: JobStatus) {
  if (from === "APPROVED" && to === "SUPERSEDED") {
    return db.execute(sql`
      update calibration_job
         set status = 'SUPERSEDED', superseded_by_id = ${fixture.otherJobId},
             superseded_at = now()
       where id = ${fixture.jobId}`);
  }
  return db.execute(
    sql`update calibration_job set status = ${to} where id = ${fixture.jobId}`,
  );
}

const FROZEN = new Set<JobStatus>(["APPROVED", "SUPERSEDED"]);

/**
 * The raw move with calibration_job_immutable_guard switched off, in a
 * transaction that is rolled back: what this trigger answers on its own.
 */
async function failureWithoutImmutabilityGuard(
  fixture: Fixture,
  from: JobStatus,
  to: JobStatus,
): Promise<PgFailure> {
  class Rollback extends Error {}
  const seen: { failure: PgFailure | null } = { failure: null };
  await db
    .transaction(async (tx) => {
      await tx.execute(
        sql`alter table calibration_job disable trigger calibration_job_immutable_guard`,
      );
      seen.failure = await failureOf(() =>
        tx.execute(
          sql`update calibration_job set status = ${to} where id = ${fixture.jobId}`,
        ),
      );
      throw new Rollback(`${from} -> ${to}`);
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  if (!seen.failure) throw new Error("expected a failure");
  return seen.failure;
}

describe("calibration_job status transition guard (migration 0119)", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
  });

  describe.each(STATUSES)("from %s", (from) => {
    it(`REQ-TRX-1 [HIGH RISK]: raw SQL moves ${from} only along the table, and refuses every other status (CF001; a frozen job reports its frozen column first)`, async () => {
      for (const to of STATUSES) {
        // eslint-disable-next-line no-await-in-loop
        await forceStatus(fixture.jobId, from);
        if (to === from) {
          // A no-op rewrite is never a transition.
          // eslint-disable-next-line no-await-in-loop
          await rawMove(fixture, from, to);
          // eslint-disable-next-line no-await-in-loop
          expect(await statusOf(fixture.jobId), `${from} -> ${to}`).toBe(from);
        } else if (LEGAL.has(`${from}>${to}`)) {
          // eslint-disable-next-line no-await-in-loop
          await rawMove(fixture, from, to);
          // eslint-disable-next-line no-await-in-loop
          expect(await statusOf(fixture.jobId), `${from} -> ${to}`).toBe(to);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const failure = await failureOf(() => rawMove(fixture, from, to));
          if (FROZEN.has(from)) {
            // calibration_job_immutable_guard (0115) answers first for a frozen job.
            expect(failure.code, `${from} -> ${to}`).toBe("P0001");
            expect(failure.message).toContain("column status is frozen");
            // ...and this guard refuses the same move on its own.
            // eslint-disable-next-line no-await-in-loop
            const alone = await failureWithoutImmutabilityGuard(
              fixture,
              from,
              to,
            );
            expect(alone.code, `${from} -> ${to} (alone)`).toBe("CF001");
            expect(alone.message).toContain(
              `calibra: illegal job transition ${from} -> ${to}`,
            );
          } else {
            expect(failure.code, `${from} -> ${to}`).toBe("CF001");
            expect(failure.message).toContain(
              `calibra: illegal job transition ${from} -> ${to}`,
            );
          }
          // The statement failed as a whole: the row did not move.
          // eslint-disable-next-line no-await-in-loop
          expect(await statusOf(fixture.jobId), `${from} -> ${to}`).toBe(from);
        }
      }
    });
  });

  it("REQ-TRX-1 [HIGH RISK]: the stray UPDATE that motivated the guard (APPROVED back to DRAFT) fails", async () => {
    await forceStatus(fixture.jobId, "APPROVED");
    const failure = await failureOf(() =>
      db.execute(
        sql`update calibration_job set status = 'DRAFT' where id = ${fixture.jobId}`,
      ),
    );
    // The immutability trigger (0115) answers first for a frozen job...
    expect(failure.code).toBe("P0001");
    expect(failure.message).toContain("column status is frozen");
    expect(await statusOf(fixture.jobId)).toBe("APPROVED");
    // ...and this guard refuses it on its own too.
    const alone = await failureWithoutImmutabilityGuard(
      fixture,
      "APPROVED",
      "DRAFT",
    );
    expect(alone.code).toBe("CF001");
    expect(alone.message).toContain(
      "calibra: illegal job transition APPROVED -> DRAFT",
    );
  });

  it("REQ-TRX-1: a multi-row UPDATE with one illegal row fails as a whole", async () => {
    await forceStatus(fixture.jobId, "DRAFT");
    await forceStatus(fixture.otherJobId, "CANCELED");
    const failure = await failureOf(() =>
      db.execute(
        sql`update calibration_job set status = 'REVIEW' where id in (${fixture.jobId}, ${fixture.otherJobId})`,
      ),
    );
    expect(failure.code).toBe("CF001");
    expect(await statusOf(fixture.jobId)).toBe("DRAFT");
    expect(await statusOf(fixture.otherJobId)).toBe("CANCELED");
  });

  it("REQ-TRX-1: an UPDATE that does not touch status is not slowed down or refused by the guard", async () => {
    await forceStatus(fixture.jobId, "REVIEW");
    await db.execute(
      sql`update calibration_job set due_date = now() where id = ${fixture.jobId}`,
    );
    expect(await statusOf(fixture.jobId)).toBe("REVIEW");
  });

  describe("REQ-TRX-2: creation", () => {
    async function insertJob(status: string) {
      return db.execute(sql`
        insert into calibration_job
          (job_id, certificate_name, organization_id, unit_id, customer_id,
           asset_id, service_id, created_by, status, method_snapshot)
        select ${`TRX-NEW-${status}`}, 'x', organization_id, unit_id, customer_id,
               asset_id, service_id, created_by, ${status}, method_snapshot
          from calibration_job where id = ${fixture.jobId}`);
    }

    it("REQ-TRX-2: a job inserted in DRAFT is accepted", async () => {
      await insertJob("DRAFT");
      const rows = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from calibration_job where job_id = 'TRX-NEW-DRAFT'`,
      );
      expect(Array.from(rows)[0]?.n).toBe(1);
    });

    it.each(STATUSES.filter((status) => status !== "DRAFT"))(
      "REQ-TRX-2: a job inserted directly in %s is refused with CF001",
      async (status) => {
        const failure = await failureOf(() => insertJob(status));
        expect(failure.code).toBe("CF001");
        expect(failure.message).toContain(
          `calibra: illegal job creation status ${status}`,
        );
      },
    );

    it("REQ-TRX-2: the hatch lets an audited import insert in another status", async () => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
        await tx.execute(sql`
          insert into calibration_job
            (job_id, certificate_name, organization_id, unit_id, customer_id,
             asset_id, service_id, created_by, status, method_snapshot)
          select 'TRX-IMPORT', 'x', organization_id, unit_id, customer_id,
                 asset_id, service_id, created_by, 'APPROVED', method_snapshot
            from calibration_job where id = ${fixture.jobId}`);
      });
      const rows = await db.execute<{ status: string }>(
        sql`select status from calibration_job where job_id = 'TRX-IMPORT'`,
      );
      expect(Array.from(rows)[0]?.status).toBe("APPROVED");
    });
  });

  describe("REQ-TRX-4: the audited-repair escape hatch", () => {
    const illegal = (id: number) =>
      sql`update calibration_job set status = 'DRAFT' where id = ${id}`;

    it("REQ-TRX-4: SET LOCAL inside a transaction lifts the guard for that transaction", async () => {
      await forceStatus(fixture.jobId, "CANCELED");
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
        await tx.execute(illegal(fixture.jobId));
      });
      expect(await statusOf(fixture.jobId)).toBe("DRAFT");
    });

    it("REQ-TRX-4: it does not outlive the transaction: the next statement is guarded again", async () => {
      await forceStatus(fixture.jobId, "CANCELED");
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
        await tx.execute(illegal(fixture.jobId));
      });
      await forceStatus(fixture.jobId, "CANCELED");
      const setting = await db.execute<{ value: string | null }>(
        sql`select current_setting('calibra.allow_status_repair', true) as value`,
      );
      expect(Array.from(setting)[0]?.value ?? "").not.toBe("on");
      const failure = await failureOf(() => db.execute(illegal(fixture.jobId)));
      expect(failure.code).toBe("CF001");
    });

    it("REQ-TRX-4: SET LOCAL outside a transaction does nothing", async () => {
      await forceStatus(fixture.jobId, "CANCELED");
      // Each statement is its own transaction, so the hatch is gone before the UPDATE.
      await db.execute(sql`set local calibra.allow_status_repair = 'on'`);
      const failure = await failureOf(() => db.execute(illegal(fixture.jobId)));
      expect(failure.code).toBe("CF001");
      expect(await statusOf(fixture.jobId)).toBe("CANCELED");
    });

    it("REQ-TRX-4: a rolled-back transaction leaves nothing behind", async () => {
      await forceStatus(fixture.jobId, "CANCELED");
      await failureOf(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
          await tx.execute(illegal(fixture.jobId));
          throw new Error("abort the repair");
        }),
      ).catch(() => undefined);
      expect(await statusOf(fixture.jobId)).toBe("CANCELED");
      const failure = await failureOf(() => db.execute(illegal(fixture.jobId)));
      expect(failure.code).toBe("CF001");
    });

    it("REQ-TRX-4: any value other than 'on' keeps the guard", async () => {
      await forceStatus(fixture.jobId, "CANCELED");
      const failure = await failureOf(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`set local calibra.allow_status_repair = 'off'`);
          await tx.execute(illegal(fixture.jobId));
        }),
      );
      expect(failure.code).toBe("CF001");
    });

    it("REQ-TRX-4: repairing an APPROVED job also needs the immutability hatch: the status hatch alone does not unfreeze a certificate", async () => {
      await forceStatus(fixture.jobId, "APPROVED");
      const failure = await failureOf(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
          await tx.execute(illegal(fixture.jobId));
        }),
      );
      expect(failure.code).toBe("P0001");
      expect(failure.message).toContain("column status is frozen");
      expect(await statusOf(fixture.jobId)).toBe("APPROVED");

      await db.transaction(async (tx) => {
        await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
        await tx.execute(sql`set local calibra.allow_audit_rewrite = 'on'`);
        await tx.execute(illegal(fixture.jobId));
      });
      expect(await statusOf(fixture.jobId)).toBe("DRAFT");
    });

    it("REQ-TRX-4: the seed hatch calibra.allow_audit_rewrite also lifts it (same convention as migration 0115)", async () => {
      await forceStatus(fixture.jobId, "CANCELED");
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local calibra.allow_audit_rewrite = 'on'`);
        await tx.execute(illegal(fixture.jobId));
      });
      expect(await statusOf(fixture.jobId)).toBe("DRAFT");
    });
  });

  it("REQ-TRX-3: migration 0119 alone installs the function and the trigger, and runs twice without error", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../packages/db/drizzle/0119_job_status_transition_guard.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toHaveLength(2);

    class Rollback extends Error {}
    const seen: { triggers: number; definition: string } = {
      triggers: 0,
      definition: "",
    };
    await db
      .transaction(async (tx) => {
        await tx.execute(
          sql`drop trigger calibration_job_status_transition_guard on public.calibration_job`,
        );
        await tx.execute(
          sql`drop function calibra_calibration_job_status_guard()`,
        );
        for (let run = 0; run < 2; run += 1) {
          for (const statement of statements) {
            // eslint-disable-next-line no-await-in-loop
            await tx.execute(sql.raw(statement));
          }
        }
        const triggers = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from pg_trigger
           where tgname = 'calibration_job_status_transition_guard' and not tgisinternal`);
        const definition = await tx.execute<{ def: string }>(sql`
          select pg_get_functiondef('calibra_calibration_job_status_guard()'::regprocedure) as def`);
        seen.triggers = Array.from(triggers)[0]?.n ?? 0;
        seen.definition = Array.from(definition)[0]?.def ?? "";
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(seen.triggers).toBe(1);
    expect(seen.definition).toContain("illegal job transition");
  });
});
