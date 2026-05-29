import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { integrationSyncItem } from "./schema";

describe("integrationSyncItem schema", () => {
  it("models per-record integration retry and dead-letter state", () => {
    expect(getTableName(integrationSyncItem)).toBe("integration_sync_item");
    expect(Object.keys(getTableColumns(integrationSyncItem))).toEqual(
      expect.arrayContaining([
        "runId",
        "integrationId",
        "organizationId",
        "target",
        "localEntityId",
        "remoteEntityId",
        "operation",
        "status",
        "attemptCount",
        "lastErrorCode",
        "lastErrorMessage",
        "requestFingerprint",
        "metadata",
      ]),
    );
  });

  it("indexes request fingerprints for retry-safe sync lookup", () => {
    const config = getTableConfig(integrationSyncItem);

    expect(config.indexes.map((index) => index.config.name)).toContain(
      "integration_sync_item_request_fingerprint_idx",
    );
  });
});
