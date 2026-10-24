/**
 * public-api-v2-idempotency.int.spec.ts - Q38 [HIGH RISK].
 *
 * The idempotency record of a public-API mutation used to be written in a
 * transaction of its own AFTER the mutation: a failure between the two let a
 * retry run the mutation again (or left a record for a mutation that rolled
 * back), and two concurrent requests with the same key both ran. The key is now
 * reserved first (in-progress, committed at once) and the mutation and the final
 * record commit in ONE transaction.
 *
 * (The v1 public API is read-only: it has no mutation and no idempotency
 * record. The mutations below are v2: webhook subscriptions and calibration
 * requests (one transaction), and a job rejection (a command that owns its
 * transactions, reserve-first only).)
 *
 *   REQ-Q38-1  A failure AFTER the mutation's writes (the final record's
 *              update is refused) leaves neither the mutation nor a record,
 *              and a retry with the same key succeeds, once.
 *   REQ-Q38-2  Two concurrent requests with the same key run the mutation
 *              once; the loser is refused 409 idempotency_in_progress and a
 *              later retry replays the winner's response.
 *   REQ-Q38-3  A replay after success answers the stored response (status and
 *              body, refusals included) without running the mutation again; the
 *              same key with another payload is 409 idempotency_conflict.
 *   REQ-Q38-4  A reservation left by a crashed request blocks the key until it
 *              expires, then the next request takes it over and runs once.
 *   REQ-Q38-5  A command (job rejection) is reserved before it runs: replayed
 *              without a second transition, and one transition under a race.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  calibrationRequest,
  calibrationRequestAuditLog,
  jobAuditLog,
  publicApiIdempotencyKey,
  publicApiWebhookSubscription,
} from "@calibra-facil/db/schema";
import { ALL_PUBLIC_API_SCOPES } from "../lib/api-keys";
import { hashIdempotencyPayload } from "../lib/public-api";
import { truncateAll } from "../../test/integration/db";
import {
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { insertJob, setJobStatus } from "../../test/integration/job-fixtures";
import { seedApiKey } from "../../test/integration/seed";
import { publicApiV2Router } from "./public-api-v2";
import {
  PublicCreateRequestSchema,
  WebhookSubscriptionSchema,
} from "./public-api-v2/schemas";

const ENV = { PUBLIC_API_MASTER_KEY: Buffer.alloc(32).toString("base64") };

async function send(
  rawKey: string,
  method: string,
  path: string,
  body: unknown,
  idempotencyKey: string,
) {
  return publicApiV2Router.request(
    path,
    {
      method,
      headers: {
        "x-api-key": rawKey,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    ENV,
  );
}

function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

async function bodyOf(response: Response) {
  return objectOf(await response.json());
}

function errorCodeOf(body: Record<string, unknown>) {
  return objectOf(body.error).code;
}

const LAB_ID = "lab-a";

type World = { lab: BillingLab; key: string; keyId: string };

async function seedWorld(): Promise<World> {
  const lab = await seedBillingLab(LAB_ID);
  const key = await seedApiKey({
    organizationId: lab.orgId,
    createdBy: lab.userId,
    scopes: [...ALL_PUBLIC_API_SCOPES],
    keyId: "key-a",
  });
  return { lab, key: key.rawKey, keyId: key.keyId };
}

const WEBHOOK_BODY = {
  name: "Integração ERP",
  targetUrl: "https://erp.example.com/hook",
  events: ["request.created"],
};

type Scenario = {
  name: string;
  method: string;
  path: string;
  body: (world: World) => unknown;
  /** Rows the mutation writes: 1 after one run, 0 when it never ran. */
  mutations: () => Promise<number>;
  /** What the route hashes: the payload as the schema parsed it. */
  hashed: (body: unknown) => unknown;
  /** The table a slow trigger holds the mutation's first write on. */
  table: string;
};

async function rowsOf(table: typeof publicApiWebhookSubscription) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

const SCENARIOS: Scenario[] = [
  {
    name: "POST /webhooks",
    method: "POST",
    path: "/webhooks",
    body: () => WEBHOOK_BODY,
    hashed: (body) => WebhookSubscriptionSchema.parse(body),
    mutations: () => rowsOf(publicApiWebhookSubscription),
    table: "public_api_webhook_subscription",
  },
  {
    name: "POST /requests",
    method: "POST",
    path: "/requests",
    body: ({ lab }) => ({
      customerId: lab.customerId,
      assetIds: [lab.assetId],
      observations: "Calibração do paquímetro",
    }),
    hashed: (body) => PublicCreateRequestSchema.parse(body),
    mutations: async () => {
      const [requests] = await db
        .select({ n: count() })
        .from(calibrationRequest);
      const [audits] = await db
        .select({ n: count() })
        .from(calibrationRequestAuditLog);
      // The request and its audit entry are one mutation: they agree.
      expect(audits?.n ?? 0).toBe(requests?.n ?? 0);
      return requests?.n ?? 0;
    },
    table: "calibration_request",
  },
];

async function recordsOf(idempotencyKey: string) {
  return db
    .select({
      status: publicApiIdempotencyKey.responseStatus,
      body: publicApiIdempotencyKey.responseBody,
    })
    .from(publicApiIdempotencyKey)
    .where(
      and(
        eq(publicApiIdempotencyKey.organizationId, LAB_ID),
        eq(publicApiIdempotencyKey.idempotencyKey, idempotencyKey),
      ),
    );
}

async function dropFaults() {
  await db.execute(
    sql.raw(`
      drop trigger if exists q38_fail_finalize on public_api_idempotency_key;
      drop function if exists q38_fail_finalize();
      drop trigger if exists q38_slow_write on public_api_webhook_subscription;
      drop trigger if exists q38_slow_write on calibration_request;
      drop trigger if exists q38_slow_write on job_audit_log;
      drop function if exists q38_slow_write();
    `),
  );
}

/** The final record's update is refused: the failure comes AFTER the writes. */
async function failFinalRecord() {
  await db.execute(
    sql.raw(`
      create function q38_fail_finalize() returns trigger language plpgsql as $$
      begin
        if new.response_status <> 0 then
          raise exception 'q38 injected failure after the mutation';
        end if;
        return new;
      end $$;
      create trigger q38_fail_finalize before update on public_api_idempotency_key
        for each row execute function q38_fail_finalize();
    `),
  );
}

/** Holds the first write of the mutation open long enough for a race. */
async function slowWrites(table: string, onlyAction?: string) {
  await db.execute(
    sql.raw(`
      create function q38_slow_write() returns trigger language plpgsql as $$
      begin
        ${onlyAction ? `if new.action = '${onlyAction}' then perform pg_sleep(1.5); end if;` : "perform pg_sleep(1.5);"}
        return new;
      end $$;
      create trigger q38_slow_write before insert on ${table}
        for each row execute function q38_slow_write();
    `),
  );
}

describe("public API v2: idempotency record commits with the mutation (Q38)", () => {
  beforeEach(async () => {
    await truncateAll();
    await dropFaults();
  });

  afterEach(async () => {
    await dropFaults();
  });

  describe.each(SCENARIOS)("$name", (scenario) => {
    it("REQ-Q38-1: a failure after the writes leaves neither the mutation nor a record; the retry succeeds once", async () => {
      const world = await seedWorld();
      const body = scenario.body(world);

      await failFinalRecord();
      const failed = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "fail-1",
      );
      expect(failed.status).toBe(500);
      // The writes rolled back with the record, and the reservation is gone.
      expect(await scenario.mutations()).toBe(0);
      expect(await recordsOf("fail-1")).toEqual([]);

      await dropFaults();
      const retried = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "fail-1",
      );
      expect(retried.status).toBe(201);
      expect(await scenario.mutations()).toBe(1);
      const records = await recordsOf("fail-1");
      expect(records.map((record) => record.status)).toEqual([201]);

      // A further retry replays: still one mutation.
      const replayed = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "fail-1",
      );
      expect(replayed.status).toBe(201);
      expect(await replayed.json()).toEqual(await retried.json());
      expect(await scenario.mutations()).toBe(1);
    });

    it("REQ-Q38-2: two concurrent requests with the same key run the mutation once", async () => {
      const world = await seedWorld();
      const body = scenario.body(world);

      // The winner's first write is held open, so the loser meets the
      // reservation while the winner is still running.
      await slowWrites(scenario.table);
      const [first, second] = await Promise.all([
        send(world.key, scenario.method, scenario.path, body, "race-1"),
        send(world.key, scenario.method, scenario.path, body, "race-1"),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = first.status === 409 ? first : second;
      const winner = first.status === 409 ? second : first;
      expect(errorCodeOf(await bodyOf(loser))).toBe("idempotency_in_progress");
      expect(await scenario.mutations()).toBe(1);

      // After the winner finished, the key replays its response.
      const replay = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "race-1",
      );
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(await winner.json());
      expect(await scenario.mutations()).toBe(1);
    });

    it("REQ-Q38-3: a replay answers the stored response without running the mutation again", async () => {
      const world = await seedWorld();
      const body = scenario.body(world);

      const created = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "replay-1",
      );
      expect(created.status).toBe(201);
      const createdBody = await created.json();
      expect(await scenario.mutations()).toBe(1);

      const replayed = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "replay-1",
      );
      expect(replayed.status).toBe(201);
      expect(await replayed.json()).toEqual(createdBody);
      expect(await scenario.mutations()).toBe(1);

      // The same key with another payload is refused, nothing runs.
      const different = await send(
        world.key,
        scenario.method,
        scenario.path,
        { ...objectOf(body), name: "Outro", observations: "Outro" },
        "replay-1",
      );
      expect(different.status).toBe(409);
      expect(errorCodeOf(await bodyOf(different))).toBe("idempotency_conflict");
      expect(await scenario.mutations()).toBe(1);
    });

    it("REQ-Q38-4: a crashed request's reservation blocks the key until it expires, then is taken over", async () => {
      const world = await seedWorld();
      const body = scenario.body(world);
      const insertReservation = (expiresAt: Date) =>
        db.insert(publicApiIdempotencyKey).values({
          id: "stale-reservation",
          organizationId: world.lab.orgId,
          apiKeyId: world.keyId,
          requestMethod: scenario.method,
          requestPath: scenario.path,
          idempotencyKey: "crash-1",
          requestHash: hashIdempotencyPayload(scenario.hashed(body)),
          responseStatus: 0,
          responseBody: {},
          expiresAt,
        });

      await insertReservation(new Date(Date.now() + 60_000));
      const blocked = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "crash-1",
      );
      expect(blocked.status).toBe(409);
      expect(errorCodeOf(await bodyOf(blocked))).toBe(
        "idempotency_in_progress",
      );
      expect(await scenario.mutations()).toBe(0);

      await db
        .update(publicApiIdempotencyKey)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(
          and(
            eq(publicApiIdempotencyKey.organizationId, LAB_ID),
            eq(publicApiIdempotencyKey.id, "stale-reservation"),
          ),
        );
      const taken = await send(
        world.key,
        scenario.method,
        scenario.path,
        body,
        "crash-1",
      );
      expect(taken.status).toBe(201);
      expect(await scenario.mutations()).toBe(1);
      expect((await recordsOf("crash-1")).map((r) => r.status)).toEqual([201]);
    });
  });

  it("REQ-Q38-3: a refusal is recorded and replayed as that refusal, not as a 200", async () => {
    const world = await seedWorld();
    const body = {
      customerId: 999_999,
      assetIds: [world.lab.assetId],
    };

    const refused = await send(
      world.key,
      "POST",
      "/requests",
      body,
      "refuse-1",
    );
    expect(refused.status).toBe(404);
    const replayed = await send(
      world.key,
      "POST",
      "/requests",
      body,
      "refuse-1",
    );
    expect(replayed.status).toBe(404);
    expect(await replayed.json()).toEqual(await refused.json());
    expect((await recordsOf("refuse-1")).map((r) => r.status)).toEqual([404]);
  });

  describe("a command that owns its transactions (job rejection)", () => {
    async function seedReviewJob(world: World) {
      const row = await insertJob({
        jobId: "CAL-A-0001",
        organizationId: world.lab.orgId,
        unitId: world.lab.unitId,
        customerId: world.lab.customerId,
        assetId: world.lab.assetId,
        serviceId: world.lab.serviceId,
        createdBy: world.lab.userId,
        methodSnapshot: {
          methodId: 1,
          methodName: "Test",
          methodVersion: 1,
          dataFields: [],
          variableBindings: [],
          formulas: [],
          measurementModels: [],
          validations: [],
          uncertaintyParams: [],
        },
        certificateName: "CAL-A-0001",
      });
      await setJobStatus(row.id, "REVIEW");
      return row.id;
    }

    async function rejections(jobId: number) {
      const [row] = await db
        .select({ n: count() })
        .from(jobAuditLog)
        .where(
          and(eq(jobAuditLog.jobId, jobId), eq(jobAuditLog.action, "reject")),
        );
      return row?.n ?? 0;
    }

    it("REQ-Q38-5: the rejection is replayed without a second transition", async () => {
      const world = await seedWorld();
      const jobId = await seedReviewJob(world);
      const body = { reason: "Dados inconsistentes" };

      const first = await send(
        world.key,
        "POST",
        `/jobs/${jobId}/reject`,
        body,
        "reject-1",
      );
      expect(first.status).toBe(200);
      const replay = await send(
        world.key,
        "POST",
        `/jobs/${jobId}/reject`,
        body,
        "reject-1",
      );
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(await first.json());
      expect(await rejections(jobId)).toBe(1);
      expect((await recordsOf("reject-1")).map((r) => r.status)).toEqual([200]);
    });

    it("REQ-Q38-5: two concurrent rejections with the same key transition the job once", async () => {
      const world = await seedWorld();
      const jobId = await seedReviewJob(world);
      const body = { reason: "Dados inconsistentes" };

      await slowWrites("job_audit_log", "reject");
      const [first, second] = await Promise.all([
        send(world.key, "POST", `/jobs/${jobId}/reject`, body, "reject-race"),
        send(world.key, "POST", `/jobs/${jobId}/reject`, body, "reject-race"),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(errorCodeOf(await bodyOf(loser))).toBe("idempotency_in_progress");
      expect(await rejections(jobId)).toBe(1);
    });
  });
});
