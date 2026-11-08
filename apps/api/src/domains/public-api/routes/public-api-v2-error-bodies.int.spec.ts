/**
 * public-api-v2-error-bodies.int.spec.ts: what an API-key holder is told when a
 * write fails for a reason that is not a refusal.
 *
 * A failed query's message carries the SQL and the bound row values. The lab's
 * organization id is one such value (every statement is org-scoped), so it
 * stands for the row data: it must reach neither the response nor the
 * idempotency record, while the cause still reaches the redacted error log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { publicApiIdempotencyKey } from "@calibra-facil/db/schema";
import { PUBLIC_API_SCOPES } from "@calibra-facil/shared";
import { sql } from "drizzle-orm";
import { truncateAll } from "../../../../test/integration/db";
import { seedBillingLab } from "../../../../test/integration/billing-fixtures";
import { seedApiKey } from "../../../../test/integration/seed";
import { publicApiV2Router } from "./public-api-v2";

const ENV = { PUBLIC_API_MASTER_KEY: Buffer.alloc(32).toString("base64") };
const LAB_ID = "lab-secret-7741";

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /jobs when the database fails", () => {
  it("answers a fixed 500 (no SQL, no bound values), keeps no idempotency record, and logs the cause redacted", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const lab = await seedBillingLab(LAB_ID);
    const key = await seedApiKey({
      organizationId: lab.orgId,
      createdBy: lab.userId,
      scopes: [...PUBLIC_API_SCOPES],
    });

    // The first statement of the job creation reads `asset`: take it away.
    await db.execute(sql`ALTER TABLE asset RENAME TO asset_away`);
    let response: Response;
    try {
      response = await publicApiV2Router.request(
        "/jobs",
        {
          method: "POST",
          headers: {
            "x-api-key": key.rawKey,
            "content-type": "application/json",
            "idempotency-key": "idem-job-db-fault",
          },
          body: JSON.stringify({
            assetId: lab.assetId,
            serviceId: lab.serviceId,
          }),
        },
        ENV,
      );
    } finally {
      await db.execute(sql`ALTER TABLE asset_away RENAME TO asset`);
    }

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "job_create_failed",
        message: "Falha ao criar OS",
        details: null,
      },
    });
    expect(text).not.toContain(LAB_ID);
    expect(text).not.toContain("Failed query");
    // A server error is not a final answer: the retry runs again.
    expect(await db.select().from(publicApiIdempotencyKey)).toEqual([]);
    const logged = stderr.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("Failed query");
    expect(logged).toContain('"step":"job-create"');
    expect(logged).toContain("params: ***");
  });
});
