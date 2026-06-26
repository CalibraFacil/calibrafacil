import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { emailSuppression, emailWebhookEvent } from "./schema";

// REQ-SUP-001: the email_suppression table is the durable record of which
// addresses must not be emailed (complaints, hard bounces, manual/API opt-outs).
// UNIQUE (email, scope) makes the suppress upsert idempotent.
describe("REQ-SUP-001: email_suppression schema", () => {
  it("REQ-SUP-001 models a suppression row with email/scope/reason/source/note/timestamps", () => {
    expect(getTableName(emailSuppression)).toBe("email_suppression");
    expect(Object.keys(getTableColumns(emailSuppression))).toEqual(
      expect.arrayContaining([
        "id",
        "email",
        "scope",
        "reason",
        "source",
        "note",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("REQ-SUP-001 enforces UNIQUE on (email, scope)", () => {
    const config = getTableConfig(emailSuppression);
    const uniqueOnEmailScope = config.indexes.some(
      (index) =>
        index.config.unique === true &&
        index.config.columns.length === 2 &&
        index.config.columns.every((column) =>
          "name" in column && typeof column.name === "string"
            ? ["email", "scope"].includes(column.name)
            : false,
        ),
    );
    expect(uniqueOnEmailScope).toBe(true);
  });

  it("REQ-SUP-002 dedup table keys provider webhook deliveries by svix id", () => {
    expect(getTableName(emailWebhookEvent)).toBe("email_webhook_event");
    const columns = getTableColumns(emailWebhookEvent);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(["svixId", "eventType", "payload"]),
    );
    // svix-id must be unique so an at-least-once redelivery is deduped.
    expect(columns.svixId.isUnique).toBe(true);
  });
});
