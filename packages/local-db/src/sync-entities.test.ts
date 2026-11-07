import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  SYNC_ENTITIES,
  SYNC_ENTITY_ORDER,
} from "@calibra-facil/contracts/sync-entities";
import { openLocalDatabase } from "./index";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("the local mirror tables of the sync entity table", () => {
  it("every entity's mirror table exists with the columns its delete mode and the bootstrap reconciliation read", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-entities-"));
    tempDirectories.push(directory);
    const database = openLocalDatabase({
      filePath: path.join(directory, "calibra.sqlite"),
    });

    for (const entity of SYNC_ENTITY_ORDER) {
      const { mirrorTable, deleteMode } = SYNC_ENTITIES[entity];
      const columns = new Set(
        database
          .prepare<[], { name: string }>(`PRAGMA table_info(${mirrorTable})`)
          .all()
          .map((column) => column.name),
      );
      expect(columns.size, `${mirrorTable} exists`).toBeGreaterThan(0);
      expect(columns.has("id"), `${mirrorTable}.id`).toBe(true);
      expect(columns.has("remote_id"), `${mirrorTable}.remote_id`).toBe(true);
      if (deleteMode === "deleted_at") {
        expect(columns.has("deleted_at"), `${mirrorTable}.deleted_at`).toBe(
          true,
        );
        expect(columns.has("sync_state"), `${mirrorTable}.sync_state`).toBe(
          true,
        );
      }
      if (deleteMode === "sync_state") {
        expect(columns.has("sync_state"), `${mirrorTable}.sync_state`).toBe(
          true,
        );
        expect(columns.has("pulled_at"), `${mirrorTable}.pulled_at`).toBe(true);
      }
    }
    database.close();
  });
});
