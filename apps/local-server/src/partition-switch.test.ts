import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  countPendingOutbox,
  LocalDatabaseOwnershipError,
  localDatabasePartitionPath,
} from "@calibra-facil/local-db";

import { createLocalServerFromConfig } from "./server";
import type { LocalServerConfig } from "./bootstrap";

/**
 * The account-switch scenario, end to end at the host level.
 *
 * This is **not** the packaged dual-host harness PAR-01 calls for — there is
 * no Electron, no renderer, no window. It drives the real local server against
 * real SQLite files, which is what proves the isolation itself: that switching
 * accounts opens a different database, that neither can read the other, and
 * that the outgoing account's queued field work survives untouched.
 *
 * What it cannot show is that the desktop *invokes* this correctly — that a
 * real sign-out and sign-in produce these calls in this order. That gap is
 * real and still open.
 */
const tempDirectories: string[] = [];

function createDataRoot() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-switch-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const ana = { userId: "user-ana", organizationId: "org-1" };
/** Same organization, different account — the case an org-only cache misses. */
const bruno = { userId: "user-bruno", organizationId: "org-1" };

function configFor(
  dataRoot: string,
  partition: { userId: string; organizationId: string },
  overrides: Partial<LocalServerConfig> = {},
): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    // Ignored whenever dataRoot and an identity are present; the server
    // derives its own file.
    dbPath: path.join(dataRoot, "unused", "calibra.sqlite"),
    dataRoot,
    requirePartition: true,
    storageRoot: path.join(dataRoot, "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: partition.organizationId,
    unitId: 1,
    userId: partition.userId,
    syncEnabled: false,
    bootstrapToken: null,
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
    ...overrides,
  };
}

async function createCustomer(
  app: ReturnType<typeof createLocalServerFromConfig>["app"],
  name: string,
) {
  const response = await app.request("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, document: "12345678000199" }),
  });

  expect(response.status).toBe(201);
  return response;
}

async function listCustomerNames(
  app: ReturnType<typeof createLocalServerFromConfig>["app"],
) {
  const response = await app.request("/api/customers");
  expect(response.status).toBe(200);

  const body: unknown = await response.json();
  const rows =
    body &&
    typeof body === "object" &&
    "data" in body &&
    Array.isArray(body.data)
      ? body.data
      : [];

  return rows.map((row: unknown) =>
    row && typeof row === "object" && "name" in row ? String(row.name) : "",
  );
}

describe("switching accounts on one machine", () => {
  it("gives each account its own database, and neither can read the other", async () => {
    const dataRoot = createDataRoot();

    const anaServer = createLocalServerFromConfig(configFor(dataRoot, ana));
    await createCustomer(anaServer.app, "Cliente da Ana");
    expect(await listCustomerNames(anaServer.app)).toEqual(["Cliente da Ana"]);

    // Bruno signs in on the same machine, same organization.
    const brunoServer = createLocalServerFromConfig(configFor(dataRoot, bruno));

    expect(await listCustomerNames(brunoServer.app)).toEqual([]);

    await createCustomer(brunoServer.app, "Cliente do Bruno");
    expect(await listCustomerNames(brunoServer.app)).toEqual([
      "Cliente do Bruno",
    ]);
  });

  it("leaves the outgoing account's data and queued work intact", async () => {
    // The promise made to a technician who signs out mid-round: nothing is
    // deleted, nothing is handed to whoever signs in next.
    const dataRoot = createDataRoot();

    const anaServer = createLocalServerFromConfig(configFor(dataRoot, ana));
    await createCustomer(anaServer.app, "Cliente da Ana");
    const anaPendingBefore = countPendingOutbox(anaServer.database);
    expect(anaPendingBefore).toBeGreaterThan(0);

    createLocalServerFromConfig(configFor(dataRoot, bruno));

    const anaAgain = createLocalServerFromConfig(configFor(dataRoot, ana));
    expect(await listCustomerNames(anaAgain.app)).toEqual(["Cliente da Ana"]);
    expect(countPendingOutbox(anaAgain.database)).toBe(anaPendingBefore);
  });

  it("writes each partition to a separate file that carries no account id", async () => {
    const dataRoot = createDataRoot();
    createLocalServerFromConfig(configFor(dataRoot, ana));
    createLocalServerFromConfig(configFor(dataRoot, bruno));

    const anaPath = localDatabasePartitionPath(dataRoot, ana);
    const brunoPath = localDatabasePartitionPath(dataRoot, bruno);

    expect(anaPath).not.toBe(brunoPath);
    expect(existsSync(anaPath)).toBe(true);
    expect(existsSync(brunoPath)).toBe(true);
    // Paths reach backups, crash reports and support bundles.
    expect(anaPath).not.toContain("user-ana");
    expect(brunoPath).not.toContain("user-bruno");
  });

  it("refuses when a host points one account at another's file", async () => {
    // The ownership record, not the path, is what enforces isolation — so a
    // host bug that computes the wrong path fails loudly instead of leaking.
    const dataRoot = createDataRoot();
    createLocalServerFromConfig(configFor(dataRoot, ana));

    expect(() =>
      createLocalServerFromConfig(
        configFor(dataRoot, bruno, {
          dataRoot: null,
          dbPath: localDatabasePartitionPath(dataRoot, ana),
        }),
      ),
    ).toThrow(LocalDatabaseOwnershipError);
  });

  it("reopens the same database for the returning account", async () => {
    const dataRoot = createDataRoot();
    createLocalServerFromConfig(configFor(dataRoot, ana));

    expect(() =>
      createLocalServerFromConfig(configFor(dataRoot, ana)),
    ).not.toThrow();
  });

  it("separates the same account across two organizations", async () => {
    const dataRoot = createDataRoot();
    const anaOrg2 = { userId: "user-ana", organizationId: "org-2" };

    const first = createLocalServerFromConfig(configFor(dataRoot, ana));
    await createCustomer(first.app, "Cliente da Org 1");

    const second = createLocalServerFromConfig(configFor(dataRoot, anaOrg2));

    expect(await listCustomerNames(second.app)).toEqual([]);
  });
});
