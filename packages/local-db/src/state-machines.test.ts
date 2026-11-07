import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalDatabase } from "./database";
import { migration0026StatusGuards } from "./migrations/0026_status_guards";
import { OUTBOX_MACHINE, sqliteStatusGuardsSql } from "./state-machines";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "calibra-status-guard-"),
  );
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop lifecycle guards generated from the state machines", () => {
  it("migration 0026 carries exactly what the current machines generate", () => {
    expect(migration0026StatusGuards.sql.trim()).toBe(
      sqliteStatusGuardsSql().trim(),
    );
  });

  it("a late accept cannot resurrect a discarded event", () => {
    expect(OUTBOX_MACHINE.canTransition("discarded", "accept")).toBe(false);
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    database
      .prepare(
        `INSERT INTO outbox (id, event_id, operation, payload_json, idempotency_key, status, created_at)
         VALUES ('o1', 'e1', 'create_customer', '{}', 'k1', 'pending', '2026-01-01')`,
      )
      .run();
    database
      .prepare("UPDATE outbox SET status = 'discarded' WHERE id = 'o1'")
      .run();
    expect(() =>
      database
        .prepare("UPDATE outbox SET status = 'synced' WHERE id = 'o1'")
        .run(),
    ).toThrow(/illegal outbox event transition/);
    expect(() =>
      database
        .prepare(
          `INSERT INTO outbox (id, event_id, operation, payload_json, idempotency_key, status, created_at)
           VALUES ('o2', 'e2', 'create_customer', '{}', 'k2', 'synced', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/illegal outbox event creation/);
    database.close();
  });
});
