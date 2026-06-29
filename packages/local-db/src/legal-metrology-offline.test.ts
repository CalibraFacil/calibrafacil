import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncBootstrap,
  createLocalAsset,
  getLocalAssetDetail,
  getLocalSchemaVersion,
  listLocalAssets,
  openLocalDatabase,
  runLocalMigrations,
  updateLocalAsset,
  type LocalDatabase,
} from "./index";
import { currentLocalDbSchemaVersion } from "./migrations";

// Legal-metrology offline / local-db parity — deferred item #5 of #423.
// Spec: specs/legal-metrology-offline-parity/spec.md (REQ-OFFLINE-001..004).
// The cloud Postgres asset columns (metrology_regime, regulated_interval,
// next_legal_verification_date, installed_at) must mirror into the offline SQLite
// store + the sync upsert so a desktop/offline lab carries the legal-metrology
// regime + install anchor and reconciles them to the cloud.

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-legal-mlr-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function assetColumns(database: LocalDatabase): string[] {
  return database
    .prepare<[], { name: string }>("PRAGMA table_info(assets)")
    .all()
    .map((column) => column.name);
}

// A shape-faithful structured regulated interval (RegulatedIntervalSchema /
// `fixed_months`) — the round-trip MUST preserve the nested object, not flatten it.
const regulatedInterval = {
  kind: "fixed_months",
  valueMonths: 12,
  anchor: "calendar_year",
  regulationReference: "Portaria Inmetro nº 157/2022",
  operationalizedByDelegate: true,
};

function seedCustomerAndAssetType(
  database: LocalDatabase,
  now: string,
) {
  database
    .prepare(
      `
INSERT INTO asset_types (
  id, remote_id, organization_id, name, specifications_schema_json, pulled_at, sync_state
) VALUES ('asset-type:10', 10, 'org-1', 'Balanca', '{}', @now, 'synced')
`,
    )
    .run({ now });
  database
    .prepare(
      `
INSERT INTO customers (
  id, remote_id, organization_id, unit_id, name, updated_at, sync_state
) VALUES ('customer:20', 20, 'org-1', 1, 'Acme Lab', @now, 'synced')
`,
    )
    .run({ now });
}

describe("legal-metrology offline parity", () => {
  it("REQ-OFFLINE-001: the local-db asset schema includes the four legal-metrology columns", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    const columns = assetColumns(database);
    expect(columns).toContain("metrology_regime");
    expect(columns).toContain("regulated_interval");
    expect(columns).toContain("next_legal_verification_date");
    expect(columns).toContain("installed_at");
    expect(getLocalSchemaVersion(database)).toBe(currentLocalDbSchemaVersion);

    database.close();
  });

  it("REQ-OFFLINE-002: a created asset round-trips the four fields (incl. a structured regulated_interval)", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    seedCustomerAndAssetType(database, now);

    const created = createLocalAsset(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: 20,
      assetTypeId: 10,
      name: "Balanca legal",
      serialNumber: "SN-LMR-1",
      tag: "BAL-LMR-1",
      status: "ACTIVE",
      metrologyRegime: "LEGAL",
      regulatedInterval,
      nextLegalVerificationDate: "2027-12-31T00:00:00.000Z",
      installedAt: "2026-01-01T00:00:00.000Z",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    expect(created.metrologyRegime).toBe("LEGAL");
    expect(created.regulatedInterval).toEqual(regulatedInterval);
    expect(created.nextLegalVerificationDate).toBe("2027-12-31T00:00:00.000Z");
    expect(created.installedAt).toBe("2026-01-01T00:00:00.000Z");

    // Read it back through a fresh query (list + detail) — write→read identity.
    const listed = listLocalAssets(database, { page: 1, limit: 20 }).data.find(
      (item) => item.tag === "BAL-LMR-1",
    );
    expect(listed?.metrologyRegime).toBe("LEGAL");
    expect(listed?.regulatedInterval).toEqual(regulatedInterval);
    expect(listed?.nextLegalVerificationDate).toBe(
      "2027-12-31T00:00:00.000Z",
    );
    expect(listed?.installedAt).toBe("2026-01-01T00:00:00.000Z");

    const detail = getLocalAssetDetail(database, "BAL-LMR-1");
    expect(detail?.regulatedInterval).toEqual(regulatedInterval);

    database.close();
  });

  it("REQ-OFFLINE-002: an updated asset round-trips changes to the four fields", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    seedCustomerAndAssetType(database, now);

    const created = createLocalAsset(database, {
      organizationId: "org-1",
      unitId: 1,
      customerId: 20,
      assetTypeId: 10,
      name: "Balanca industrial",
      serialNumber: "SN-LMR-2",
      tag: "BAL-LMR-2",
      status: "ACTIVE",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    // Default regime on create mirrors the cloud column default.
    expect(created.metrologyRegime).toBe("INDUSTRIAL");
    expect(created.regulatedInterval).toBeNull();
    expect(created.nextLegalVerificationDate).toBeNull();
    expect(created.installedAt).toBeNull();

    const updated = updateLocalAsset(database, {
      identifier: "BAL-LMR-2",
      metrologyRegime: "LEGAL",
      regulatedInterval,
      nextLegalVerificationDate: "2027-12-31T00:00:00.000Z",
      installedAt: "2026-02-01T00:00:00.000Z",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    expect(updated.metrologyRegime).toBe("LEGAL");
    expect(updated.regulatedInterval).toEqual(regulatedInterval);
    expect(updated.nextLegalVerificationDate).toBe("2027-12-31T00:00:00.000Z");
    expect(updated.installedAt).toBe("2026-02-01T00:00:00.000Z");

    // Clearing the regime back to a non-LEGAL value also round-trips.
    const cleared = updateLocalAsset(database, {
      identifier: "BAL-LMR-2",
      metrologyRegime: "INDUSTRIAL",
      regulatedInterval: null,
      nextLegalVerificationDate: null,
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    expect(cleared.metrologyRegime).toBe("INDUSTRIAL");
    expect(cleared.regulatedInterval).toBeNull();
    expect(cleared.nextLegalVerificationDate).toBeNull();
    // installedAt was not in the update → preserved.
    expect(cleared.installedAt).toBe("2026-02-01T00:00:00.000Z");

    database.close();
  });

  it("REQ-OFFLINE-003: the cloud→offline sync upsert carries the four columns", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();

    applySyncBootstrap(database, {
      serverTime: now,
      user: { id: "user-1", name: "User One", email: "user@example.com" },
      organization: { id: "org-1", type: "LAB" },
      activeUnits: [{ id: 1, name: "Matriz", role: "technician" }],
      permissions: {
        role: "technician",
        unitRole: "technician",
        activeUnitId: 1,
        accessibleUnitIds: [1],
        canAccessAllUnits: false,
      },
      featureFlags: {
        offlineApprovals: false,
        offlineCertificatePublication: false,
      },
      syncCursor: now,
      publishedMethods: [],
      assetTypes: [
        {
          id: 10,
          organizationId: "org-1",
          name: "Hidrômetro",
          description: null,
          definition: null,
        },
      ],
      customers: [
        {
          id: 20,
          name: "Acme Lab",
          taxId: null,
          email: null,
          phone: null,
          address: null,
          compliance: null,
          updatedAt: now,
        },
      ],
      assets: [
        {
          id: 30,
          unitId: 1,
          customerId: 20,
          assetTypeId: 10,
          name: "Hidrômetro legal",
          serialNumber: "SN-CLOUD-1",
          tag: "TAG-CLOUD-1",
          manufacturer: null,
          model: null,
          baseMeasurementUnit: null,
          specifications: null,
          metrologyRegime: "LEGAL",
          regulatedInterval,
          nextLegalVerificationDate: "2027-12-31T00:00:00.000Z",
          installedAt: "2026-03-01T00:00:00.000Z",
          status: "ACTIVE",
          updatedAt: now,
        },
      ],
      services: [],
      standards: [],
      massCompositionProfiles: [],
      environmentalLimits: [],
      jobs: [],
      serviceOrders: [],
    });

    const asset = listLocalAssets(database, { page: 1, limit: 20 }).data.find(
      (item) => item.tag === "TAG-CLOUD-1",
    );
    expect(asset?.metrologyRegime).toBe("LEGAL");
    expect(asset?.regulatedInterval).toEqual(regulatedInterval);
    expect(asset?.nextLegalVerificationDate).toBe("2027-12-31T00:00:00.000Z");
    expect(asset?.installedAt).toBe("2026-03-01T00:00:00.000Z");

    database.close();
  });

  it("REQ-OFFLINE-004: re-running migrations is idempotent and preserves existing rows", () => {
    const databasePath = createTempDatabasePath();
    const first = openLocalDatabase({ filePath: databasePath });
    const now = new Date("2026-01-15T10:00:00.000Z").toISOString();
    seedCustomerAndAssetType(first, now);

    createLocalAsset(first, {
      organizationId: "org-1",
      unitId: 1,
      customerId: 20,
      assetTypeId: 10,
      name: "Balanca legal",
      serialNumber: "SN-LMR-3",
      tag: "BAL-LMR-3",
      status: "ACTIVE",
      metrologyRegime: "LEGAL",
      regulatedInterval,
      nextLegalVerificationDate: "2027-12-31T00:00:00.000Z",
      installedAt: "2026-01-01T00:00:00.000Z",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    // Second run on the SAME open connection MUST NOT error or duplicate columns.
    expect(() => runLocalMigrations(first)).not.toThrow();

    const countOf = (column: string) =>
      assetColumns(first).filter((name) => name === column).length;
    expect(countOf("metrology_regime")).toBe(1);
    expect(countOf("regulated_interval")).toBe(1);
    expect(countOf("next_legal_verification_date")).toBe(1);
    expect(countOf("installed_at")).toBe(1);

    first.close();

    // Re-opening also re-runs the migration runner (real client lifecycle) and
    // MUST preserve the existing row with its legal-metrology fields intact.
    const second = openLocalDatabase({ filePath: databasePath });
    const preserved = getLocalAssetDetail(second, "BAL-LMR-3");
    expect(preserved?.metrologyRegime).toBe("LEGAL");
    expect(preserved?.regulatedInterval).toEqual(regulatedInterval);
    expect(preserved?.nextLegalVerificationDate).toBe(
      "2027-12-31T00:00:00.000Z",
    );
    expect(preserved?.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(getLocalSchemaVersion(second)).toBe(currentLocalDbSchemaVersion);

    second.close();
  });
});
