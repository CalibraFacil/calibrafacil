import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { openLocalDatabase } from "./database";
import {
  getLocalSessionSnapshot,
  hasTenantSnapshot,
  readLocalTenantContext,
  readLocalTenantIdentity,
} from "./tenant-snapshot";

const tempDirectories: string[] = [];

function createDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-tenant-"));
  tempDirectories.push(directory);
  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function insertSnapshot(
  database: ReturnType<typeof createDatabase>,
  row: {
    organizationId: string;
    userId: string;
    activeUnitId: number | null;
    pulledAt: string;
    snapshotJson?: string;
  },
) {
  database
    .prepare(
      `INSERT INTO tenant_snapshot (tenant_id, organization_id, active_unit_id, user_id, snapshot_json, pulled_at)
       VALUES (@organizationId, @organizationId, @activeUnitId, @userId, @snapshotJson, @pulledAt)`,
    )
    .run({ snapshotJson: "{}", ...row });
}

describe("tenant snapshot readers", () => {
  it("read nothing from a database that was never bootstrapped", () => {
    const database = createDatabase();

    expect(hasTenantSnapshot(database)).toBe(false);
    expect(readLocalTenantIdentity(database)).toBeNull();
    expect(readLocalTenantContext(database)).toBeNull();
    expect(getLocalSessionSnapshot(database)).toBeNull();
    database.close();
  });

  it("all read the latest pulled row", () => {
    const database = createDatabase();
    insertSnapshot(database, {
      organizationId: "org-old",
      userId: "user-old",
      activeUnitId: 1,
      pulledAt: "2026-01-01T00:00:00.000Z",
    });
    insertSnapshot(database, {
      organizationId: "org-new",
      userId: "user-new",
      activeUnitId: 7,
      pulledAt: "2026-02-01T00:00:00.000Z",
    });

    expect(hasTenantSnapshot(database)).toBe(true);
    expect(readLocalTenantIdentity(database)).toEqual({
      userId: "user-new",
      organizationId: "org-new",
    });
    expect(readLocalTenantContext(database)).toEqual({
      organizationId: "org-new",
      unitId: 7,
      userId: "user-new",
    });
    database.close();
  });

  it("reads a missing active unit as null, and a snapshot that does not parse as none", () => {
    const database = createDatabase();
    insertSnapshot(database, {
      organizationId: "org-1",
      userId: "user-1",
      activeUnitId: null,
      pulledAt: "2026-01-01T00:00:00.000Z",
      snapshotJson: "not json",
    });

    expect(readLocalTenantContext(database)?.unitId).toBeNull();
    expect(getLocalSessionSnapshot(database)).toBeNull();
    database.close();
  });
});
